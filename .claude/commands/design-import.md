---
description: 把一份 HTML 设计稿导入为 tokens.json + DESIGN_SPEC.md + 实施计划
argument-hint: <设计稿路径或 design-spec/html/ 下的文件名>
---

调用 `design-handoff` 技能，处理设计稿：$1

按技能里的四阶段走，本次只做到**阶段 3 结束 + 阶段 4 的计划**，不要写实现代码：

1. 读稿：先把视口、主题数、明暗、语义色/主题色的划分说清楚。信息不足就问我，不要猜。
2. 抽令牌：更新（不是覆盖）`design-spec/tokens.json`。已有键沿用旧名，新增键单独列出来给我确认。
3. 写规范：更新 `design-spec/DESIGN_SPEC.md` 的对应小节；只写与现状的差异，不复述已有内容。
4. 出计划：列出**文件清单 + 每个文件改什么 + 预计影响的屏**，写进 `design-spec/PATCH.md`。

最后输出三样东西给我过目：新增令牌表、规范 diff 摘要、实施文件清单。我确认后再动代码。
