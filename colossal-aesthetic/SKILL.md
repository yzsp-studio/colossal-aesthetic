---
name: colossal-aesthetic
description: >-
  Use when the user wants prompts for colossal-scale or monumental aesthetics
  (giant objects, monumental proportions, overwhelming scale contrast) for AI image
  or AI video generation, or wants to lock / verify a consistent visual style across
  a series of generated images and videos. Provides a subject-agnostic style lock
  (scale narrative, camera discipline, translucency, color boundaries, negative space,
  shelter logic), a verified sub-style library, ready-to-paste image and video prompts
  for current mainstream models, and a pixel-level style checker. Applies to any
  subject - plants, architecture, machinery, creatures, props, fabric, terrain - not
  just the reference subject matter.
whenToUse: >-
  Trigger on requests about 巨物美学, 巨物, monumental scale, colossal scale, epic scale
  contrast, tiny figure against giant object, style locking, style consistency across
  shots, or keeping a series of images/videos visually identical in style.
author: yzsp-ai
repository: https://github.com/yzsp-ai
---


# 巨物美学 · 风格锁（Colossal Aesthetic Style Lock）

## Core Mission

把用户的**任意题材**，装配成能产出「巨物美学」的统一风格提示词——**图像提示词一次成稿，视频提示词一次成稿，都不需要二次加工**；并在出图后提供**像素级校验**，确认风格真的锁住了。

**这个 Skill 锁的是风格，不是题材。** 用户要做巨型蘑菇、巨型机械、巨型鲸、巨型书库、巨型织物……都走同一套核心锁。

## 三层结构（先理解这个，再看别的）

| 层 | 内容 | 谁决定 | 文件 |
|---|---|---|---|
| **核心锁** | 十条题材无关的不变量 | 本 Skill 锁定，**不许改** | `references/01-风格锁核心.md` |
| **子风格** | 光质、明度档位、色温、配色配方、情绪基调 | 使用者选一个（或按扩展框架新建） | `references/02-子风格库.md` |
| **题材** | 具体画什么 | **使用者任意指定，本 Skill 不做限制** | — |

**最常见的失败模式**：把参考素材的题材（花卉、人物、服饰）写进风格定义里。那样做出来的提示词只能画那一个题材，换个题目就散架。**参考素材的题材只能出现在"示例配方"里，不能出现在核心锁里。**

## 数据资产（本 Skill 自包含，路径相对于本文件所在目录）

| 文件 | 内容 | 可信度 |
|---|---|---|
| `references/01-风格锁核心.md` | 十条核心锁 + 实测阈值表 + 六步套用流程 | 阈值全部来自实测 |
| `references/02-子风格库.md` | 4 个已验证子风格 + 参考素材示例配方 + 扩展框架 | 配方，可扩展 |
| `references/03-图像提示词语法.md` | 图像提示词十槽装配骨架 + 完整示例 | 骨架为方法论 |
| `references/04-视频提示词语法.md` | 视频提示词骨架 + 运镜词表 + 剪辑节奏 | 节奏来自视频实测 |
| `references/05-平台适配.md` | 各主流图像/视频模型的投放要点 | 见该文件的未核实清单 |
| `references/06-风格校验与迭代.md` | 逐项失败 → 改法 + 长视频续接 | — |
| `references/07-参考素材实测档案.md` | 素材清单、全部实测数值、**素材没有提供什么** | 实测 |
| `data/风格实测数据.json` | 机器可读的完整实测数据 | 实测 |
| `scripts/style-check.mjs` | 像素级风格校验器（零依赖，支持 PNG 与 JPEG） | 已交叉验证 |

## 工作流

### 模式 A · 生成提示词（主要用法）

1. **读** `references/01-风格锁核心.md`（每次都要读，这是锁的定义）。
2. **判断题材可行性**：按核心锁第 4 节第 1 步的三个问题筛题材。不适合就直说，并给出替代建议。
3. **选子风格**：读 `references/02-子风格库.md`，选最贴合的一个；都不合适就按扩展框架新建（必须继承核心锁）。
4. **装配**：图像走 `03`，视频走 `04`。**十条核心锁逐条落到提示词里，一条都不许省。**
5. **按平台适配**：读 `references/05-平台适配.md`，调整负向约束的给法与画幅写法。
6. **输出**：见下面「输出模板」。

**输出必须是成品**：用户拿到就能直接粘贴到模型里，不需要自己拼装、不需要补充风格描述。

### 模式 B · 校验已有出图

```
node scripts/style-check.mjs <图片...> [--ref <参考图目录>] [--json]
```

读出实测指标 → 对照 `01` 第 2 节的阈值表 → 按 `06` 定位改法。**先量再改，不要凭感觉调。**

### 模式 C · 反推已有画面的风格

用户给一张图问"这是什么风格/怎么复刻"时：用 `scripts/style-check.mjs --json` 量出色彩指标，目视判断尺度叙事、机位、透光、庇护性，再映射到 `02` 的子风格；**不要凭印象描述**。

## Hard Rules

1. **锁的是风格，不是题材。** 判据不是"有没有出现题材词"，而是**题材词有没有成为风格定义的一部分**：
   - ❌ 禁止：把题材写进风格定义（例如"巨物是荷花形穹顶"）——换个题材就散架；
   - ✅ 允许且必要：题材词作为**跨题材适用示例**（"无论主体是巨型真菌、深海巨兽还是机械构件……"）、作为**反面教材**、或作为**参照物变量表**出现，但必须明确标注为示例；
   - 参考素材的题材只允许以"已验证示例配方"的身份出现在 `02-子风格库.md`；
   - **终极检验**：把提示词里的题材词全删掉，剩下的话若仍能描述出这套美学，才算锁住了风格。
2. **不许编造数值。** 阈值只有两个来源：本 Skill 的实测数据，或参考素材的实测数据。没有依据就写「未核实」，不要给一个看起来专业的数字。
3. **十条核心锁一条都不许省。** 省略哪条，哪条就会在出图时漂——这是实测结论。
4. **输出是成品提示词。** 不给半成品、不要求用户二次加工、不输出"请自行组合"。
5. **负向约束按平台形态给**：有独立负向框才单独给；没有的（如 Gemini 系）必须改写成正向句式并入同一条。
6. **不做题材审查**：用户要画什么就画什么（政治、宗教、真实人物、在世品牌等敏感题材除外，此时按平台政策提示风险）。
7. **不生成图片或视频。** 本 Skill 只产出方向、配色、提示词与校验。
8. **每条提示词的配色槽末尾必须带两句防灰化约束**（实测可复现的必需项，见 `01` 锁 6）：
   `The image must not read as monochrome: keep the cool zone and the warm zone separately readable in the color distribution.`
   `Retain a definite saturation floor: muted but present color, never near-grey.`
   缺这两句时实测出图饱和度掉到 9.6–13.4（参考素材中位 26.6），风格校验仅 6–7/8 通过。

## Output Template

```
## 一、题材可行性判断
题材：… ｜ 巨物候选：… ｜ 是否适合本风格：是/否（依据核心锁第 1 步三问）

## 二、子风格选择
选：A/B/C/D 或新建 ｜ 理由：… ｜ 光质/明度档位/配色配方：…

## 三、尺度设计
参照物：… ｜ 体量比：… ｜ 庇护性结构：… ｜ 溢出画框方式：…

## 四、提示词（成品，可直接粘贴）
<模型名>
<完整提示词>

Negative: <仅当该平台有独立负向框>

中文说明：每个槽在做什么（逐槽一行）

## 五、怎么用这条提示词
- 一条提示词 = 一张图/一段视频，逐条出，不要合并粘贴
- 正负分开贴；无负向框的平台把负向改写成正向并入正文
- 画幅靠界面或参数设置，不要当风格词写进正文
- 出图后跑 `node scripts/style-check.mjs <图> --ref <参考图目录>` 校验
- 迭代时一次只改一个变量
（视频提示词另加：分镜时长、运镜、是否需要首尾帧续接）

## 六、自查
核心锁十条 ☐×10 ｜ 通用性试金石：删掉题材词后，剩下的话是否仍描述得出这套美学？

## 七、如果效果不对
按 references/06 的「逐项失败 → 改法」表定位；先量再改。
```

## References

- `references/01-风格锁核心.md` — **必读**，十条核心锁与实测阈值
- `references/02-子风格库.md` — 子风格配方与扩展框架
- `references/03-图像提示词语法.md` — 图像提示词装配
- `references/04-视频提示词语法.md` — 视频提示词装配
- `references/05-平台适配.md` — 各平台投放要点
- `references/06-风格校验与迭代.md` — 校验、改法、续接
- `references/07-参考素材实测档案.md` — 实测数据与素材局限
