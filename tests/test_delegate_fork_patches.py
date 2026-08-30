# -*- coding: utf-8 -*-
"""Fork 定制的行为测试:显式角色优先 + 进程级叶子并发限制。

覆盖 89b0755de 及后续修复的四组行为:
  1. 显式 leaf        → 永远是 leaf(即使深度预算充足)
  2. 显式 orchestrator → 深度预算内生效,预算耗尽降级 leaf
  3. 深度降级         → orchestrator_enabled=False 时强制 leaf
  4. 跨批次叶子并发    → 信号量按进程全局计数,orchestrator 豁免
"""
import threading

import pytest

from tools.delegate_tool import (
    _LEAF_LIMITER,
    _LEAF_LIMITER_LOCK,
    _leaf_limiter_acquire,
    _leaf_limiter_release,
    _resolve_child_role,
)


# ── 角色解析(纯函数) ────────────────────────────────────────────────


class TestExplicitRoleFirst:
    def test_explicit_leaf_stays_leaf_even_with_depth_budget(self):
        assert _resolve_child_role("leaf", child_depth=1, max_spawn_depth=2, orchestrator_enabled=True) == "leaf"

    def test_explicit_orchestrator_granted_within_depth(self):
        assert _resolve_child_role("orchestrator", child_depth=1, max_spawn_depth=2, orchestrator_enabled=True) == "orchestrator"

    def test_depth_exhausted_degrades_orchestrator_to_leaf(self):
        assert _resolve_child_role("orchestrator", child_depth=2, max_spawn_depth=2, orchestrator_enabled=True) == "leaf"

    def test_kill_switch_forces_leaf(self):
        assert _resolve_child_role("orchestrator", child_depth=1, max_spawn_depth=2, orchestrator_enabled=False) == "leaf"

    def test_default_none_is_leaf(self):
        assert _resolve_child_role(None, child_depth=1, max_spawn_depth=2, orchestrator_enabled=True) == "leaf"

    def test_unknown_string_coerces_to_leaf(self):
        assert _resolve_child_role("boss", child_depth=1, max_spawn_depth=2, orchestrator_enabled=True) == "leaf"

    def test_top_level_agent_always_orchestrator_capable(self):
        # depth=0(顶层)显式 orchestrator 且预算充足
        assert _resolve_child_role("orchestrator", child_depth=0, max_spawn_depth=2, orchestrator_enabled=True) == "orchestrator"


# ── 叶子并发限制器(信号量) ──────────────────────────────────────────


class _FakeChild:
    def __init__(self, role="leaf"):
        self._delegate_role = role


@pytest.fixture(autouse=True)
def _reset_limiter():
    global _LEAF_LIMITER
    with _LEAF_LIMITER_LOCK:
        _LEAF_LIMITER = None
    # 临时把并发上限固定为 2,避免受 config.yaml 影响
    import tools.delegate_tool as dt

    original = dt._get_max_concurrent_children
    dt._get_max_concurrent_children = lambda: 2
    yield
    dt._get_max_concurrent_children = original
    with _LEAF_LIMITER_LOCK:
        _LEAF_LIMITER = None


class TestLeafLimiter:
    def test_orchestrator_children_exempt(self):
        child = _FakeChild(role="orchestrator")
        assert _leaf_limiter_acquire(child, blocking=False) is None

    def test_leaves_count_toward_cap(self):
        slots = []
        for _ in range(2):  # cap=2
            slot = _leaf_limiter_acquire(_FakeChild("leaf"), blocking=False)
            assert slot is not None
            slots.append(slot)
        # 第 3 个叶子:跨批次也应被拦(cap 是进程级全局)
        assert _leaf_limiter_acquire(_FakeChild("leaf"), blocking=False) is None
        for s in slots:
            _leaf_limiter_release(s)

    def test_release_frees_slot_across_batches(self):
        first = _leaf_limiter_acquire(_FakeChild("leaf"), blocking=False)
        _leaf_limiter_release(first)
        second = _leaf_limiter_acquire(_FakeChild("leaf"), blocking=False)
        assert second is not None
        _leaf_limiter_release(second)

    def test_mixed_roles_only_leaves_counted(self):
        s1 = _leaf_limiter_acquire(_FakeChild("leaf"), blocking=False)
        _leaf_limiter_acquire(_FakeChild("orchestrator"), blocking=False)  # 不占额
        _leaf_limiter_acquire(_FakeChild("orchestrator"), blocking=False)
        s2 = _leaf_limiter_acquire(_FakeChild("leaf"), blocking=False)  # 仅 1 片叶子,仍有余量
        assert s2 is not None
        _leaf_limiter_release(s1)
        _leaf_limiter_release(s2)

    def test_blocking_acquire_succeeds_when_slot_free(self):
        slot = _leaf_limiter_acquire(_FakeChild("leaf"), blocking=True)
        assert slot is not None
        _leaf_limiter_release(slot)
