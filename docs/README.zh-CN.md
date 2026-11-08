# Latticefolk

<p align="center"><img src="assets/cover.svg" alt="Latticefolk" width="100%"></p>

<p align="center">
<strong>一个面向自主 NPC、小镇社会与演化世界的 3D Web 开源模拟项目。</strong>
</p>

<p align="center"><a href="../README.md">English</a> · <b>简体中文</b> · <a href="README.ja.md">日本語</a> · <a href="README.es.md">Español</a></p>

Latticefolk 的目标不是做“会聊天的 NPC 演示”，而是让决策模型真正参与一个持续运行的世界：NPC 会工作、采集、制作、交易、赠礼、送货、取水、巡逻、拜访、休息、睡眠、探索并建立关系；远处区域也会以粗粒度 chunk 状态持续演化，并由可插拔决策引擎参与区域策略。

项目**不绑定 Jev**。Jev / TypeSafe System One 是当前第一个远程决策适配器，核心模拟只依赖通用的 `DecisionProvider`。

## 当前已经实现

- 场景恢复已补入现成树木的成年尺度/树干锚点、当前蒙皮脚底支撑、有界接触阴影、玩家与角色头部间距和保留原件的作物非金属材质修正；全场景、坐卧姿态及完整旅程仍未验收完成。详见[表现层范围](environment-presentation.md)。
- Three.js 第一人称 3D 小镇与真正的观察者上帝视角。
- 约 20 种有界 NPC 行为，行为会真实改变库存、金钱、关系和需求。
- 统一 `WorldObject + capabilities` 交互体系：房屋、水井、市场、箱桶、推车、树木、岩石、花、工具、床、工作台等都属于真实世界对象，而不是单纯装饰。
- 本地 deterministic fallback + 可选 Jev provider。
- 远区 chunk 粗模拟与批量 Jev 策略 / 迁徙 / 生态决策。
- SQLite 持久化：远区状态、访问过的细粒度 chunk、中心小镇、玩家背包/位置、时间和天气可跨重启恢复。
- 跨 chunk 守恒流：人口迁徙、食物/木材/水贸易和生态传播都有明确来源、目的地和数量。
- Region / World 层决策：决策范围越大、频率越低，只选择有界策略，数值结算仍由确定性模拟负责。
- 上帝控制台 Jev input-token 与费用预算：分钟 / 小时 / 每日 token、每日 USD 上限、置信度阈值、缓存、调用类型统计和省流 / 平衡 / 高质量预设。
- 检索优先的预制台词库，支持完整台词和 opener/body/closer 片段组合。
- 简体中文、English、日本語、Español UI 与语料支持。
- Quaternius CC0 低多边形角色、建筑和道具素材。
- 野生动物永久谱系与进化观测：死亡或卸载后的祖先仍保存在 SQLite；区分 founder 与真实繁殖出生，统计死亡原因、后代数、繁殖成功率、代际 trait 均值/方差/趋势，并在 God View 中查看谱系和进化数据。
- biome 选择压力观测：谱系记录出生/死亡环境，God View 按 biome 展示繁殖者相对 cohort 的标准化 trait 差值、跨代同向一致性、样本量及“样本不足/弱信号/持续信号”，不把相关性直接写成因果。
- 生命周期 habitat 暴露：个体只在实际 fine simulation 期间累计环境暴露天数、时间加权 ecology/food/water/danger、biome/chunk 时长和已观测迁移；coarse 时段不会伪造为命名个体轨迹，并可在 God View 对比出生 biome 与 lifetime dominant biome 的选择证据。
- 可保留身份的 fine wildlife migration：命名个体只能迁往合法相邻 chunk，保留 entity ID、父母、代数、traits、妊娠和 habitat history；确定性模拟负责 carrying capacity、coarse 数量守恒、代表权重、transit persistence 与迁徙 provenance。
- 确定性生态位竞争：兔/鹿/野猪/山羊/狐狸/狼使用固定资源 profile 计算 pairwise niche overlap，并结合其他物种密度形成 competition pressure；压力会有界降低有效 carrying capacity、影响健康，并进入 God View 与 lineage habitat exposure。
- 季节迁徙驱动：物种×biome 的春夏秋冬适宜度结合当前 forage、水、生态和危险形成 seasonal suitability；高出至少 8 分的相邻 habitat 可独立产生低幅度守恒迁徙，fine wildlife 也只能在合法候选中参考该信号。
- 更丰富的疾病传播：coarse 显式拆分环境、同种接触、跨种接触和迁徙输入四类 disease pressure；fine wildlife 按真实邻近个体、距离和固定跨种接触系数传播，God View 与 lineage exposure 都可观察疾病压力。
- fitness-by-habitat 证据：把 lifetime competition、seasonal suitability、disease pressure、predator pressure 与繁殖成功、后代数、寿命做关联分析；存活未成年个体在达到成年前从 reproduction/offspring 结果中右删失，幼年死亡仍保留为完整未繁殖结果；样本不足或无方差时显示不可估计而不是伪装成 0，并按低/中/高暴露 cohort 展示 breeder rate 与 trait differential，不宣称因果。
- predator-pressure 可观测性：依据实际 predator population density 与共享 prey preference 为每个物种计算 0–100 捕食压力；该值只进入 God View、lineage lifetime exposure 与 fitness evidence，不额外扣 health 或 population，真实死亡仍由 deterministic predation 结算。
- predator/prey specialization 证据：coarse 保留 predator→prey 压力来源分解，fine lineage 只在实际观测期累计按捕食者来源拆分的时间加权压力；旧历史没有来源数据时保持“未知”而不是补成 0，God View 可按 fox/wolf 等来源查看繁殖、后代数、寿命关联和 breeder trait differential。
- realized hunting/escape 证据：只有 deterministic fine action resolution 才记录 hunt attempt/hit/kill、flee attempt/success、attack received/survived，并按 counterpart species 分解；Decision Provider 只能选 hunt/flee 与合法目标，不能宣告成功。God View 展示命中率、击杀率、逃脱率、受击存活率及成功个体相对已观测 cohort 的 trait differential。
- predator/prey trait matching：实际发生交互的两个个体会记录 actor−counterpart trait delta；predator 按 attempt/hit/kill，prey 按 flee attempt/escape 与 attack/survival 分层统计，并保存独立 paired-snapshot count，避免旧 realized outcomes 没有 trait snapshot 时被当作 0 或稀释新样本。God View 还展示最近几代的实际成功率和配对性状优势。
- multi-generation coevolution evidence：对每个真实 predator→prey pair 分别保留 predator-side 与 prey-side 的独立 generation series，不把两个物种相同 generation 编号当成同步 cohort；每侧关联 realized performance、成年/繁殖资格后的 breeder rate、offspring mean、trait mean 与实际配对性状优势。相关性至少需要 3 个有效代点，趋势至少需要 2 个点；证据不足或无方差时保持不可估计，不自动宣称存在共进化。
- multi-species interaction network：把 predation、对称 niche competition、定向 cross-species disease transmission 统一为只读生态网络。每种 interaction 都有独立 coverage；旧 chunk 缺完整 pair decomposition 时保持未知，不当成 0。God View 只聚合 bounded active window，`/api/world/interactions` 则聚合持久化 discovered chunks；网络不会反向修改 population、health 或决策候选。
- network-linked niche / disease source evidence：fine lineage 只在实际观测期累计各 counterpart species 的 competition pressure 与各 source species 指向当前物种的 disease pressure；两类来源各自维护独立 observed-days 分母，旧数据无 pair decomposition 时保持未知。God View 与 evolution stats 按 right-censoring 规则展示来源压力和 reproduction / offspring / lifespan 关联及 breeder trait differential，不宣称因果。
- generation-level competition / disease source evidence：每个来源关系建立独立 target←source generation series，按目标物种自己的 generation 统计 pressure、breeder/offspring、death-sample lifespan 与 trait trend；同一物种对双侧证据只并排展示，不把相同 generation 编号当作同步 cohort，也不自动宣称 reciprocal causation。趋势至少需要 2 个代点，相关至少需要 3 个有效代点。
- multi-factor interaction selection evidence：按 reproduction / offspring / lifespan 分别构建 complete-case 模型，同时纳入有足够覆盖和方差的 predator / competition / disease 来源压力，最多 6 个特征。legacy unknown 不填 0；在 ridge（λ=0.25）拟合前先检查未正则化 predictor correlation matrix，矩阵奇异、max|rX|≥0.98 或 max VIF>10 时标记 `unstable_collinearity` 且不输出 β*。通过稳定性门控后才展示 β*、coverage、R²、max|rX| 与 max VIF，仅作为多因素正则化关联，不宣称因果。
- multi-factor stability / generation-local evidence：对目标物种执行有界 generation-omission 重拟合；历史不超过 12 代时逐代检查，更长历史则在首尾之间确定性等距选最多 12 个 probe。只有 feature set 与 pooled model 完全一致的可估计结果才进入系数范围与符号一致性统计。local evidence 最多覆盖最近 6 个 endpoint，每个最多向前搜索 8 个目标物种 generation，仍不可估计时显式标记截断。当前 exposure 只有 lifetime aggregate，因此不会伪造逐日时间序列，也不跨物种同步 generation。
- profile-driven wildlife diversity：把 trophic role、biome/season affinity、niche/resource use、growth/carrying capacity、fine trait baseline、feeding/hunting、life history、predation 参数与 constrained procedural morphology 统一收敛到 simulation-owned `WildlifeSpeciesProfile`。新增獾作为真正的 omnivore：既会 forage/消耗植物，也可合法捕食兔子，狼还能捕食獾；它同时进入 competition、disease、migration、lineage 与 evolution observability。旧 coarse 存档会增量补入新物种，而历史 pressure map 缺失新物种 key 时保持 unknown，不伪造为 0。
- 可遗传 wildlife phenotype：体长/体高/腿长/头部/尾部比例，以及 forage、migration、risk tolerance、recovery drive 都成为物种约束范围内的有界表型。founder 由 entity ID 确定性初始化，后代按父母均值 + bounded deterministic mutation 继承；形态直接改变 procedural body，行为基因只改变 bounded fallback 阈值。Jev 只能读取 phenotype 作为决策上下文，不能写基因或生理结果。lineage 持久化 birth/death phenotype，并区分 `birth`、`founder_seed`、`legacy_upgrade`；后者不会进入历史代际 trend / breeder differential，避免升级旧存档时伪造进化历史。
- phenotype→function trade-off：继承表型现在会确定性映射到窄范围的移动速度、移动能耗、基础维持成本、觅食效率、休息恢复和高强度动作能耗。长腿可提高速度但会增加移动成本，较大体型提高维持成本，所有倍率都被 clamp 在接近 1 的范围。God View 还会按实际观测 lifetime dominant biome 统计 phenotype 与 reproduction / offspring / lifespan 的关联，并继续使用成年资格 right-censoring；`legacy_upgrade` 只用于当前描述，不进入历史环境适应证据。
- constrained organism families：当前 wildlife 分为 lagomorph / cervid / suiform / caprine / canid / mustelid / felid / bovid / procyonid 家族，每个 fine individual 都有确定性初始化并可遗传/突变的 family genome，控制材质色偏、已有合法植物生态位的偏好分配，以及 stride/endurance 的速度-能耗 trade-off。family genome 不能新增 species 原本为 0 的 plant axis，也不能修改 prey graph、trophic role 或 coarse 资源规则；Jev 只读。genome 随 fine state / transfer / lineage 持久化，God View 与 evolution API 展示 provenance coverage、均值、方差、代际趋势和 breeder differential。
- reusable generated organism archetypes：species profile 现在由 habitat、ecology/trophic niche、procedural body/family、movement mode、semantic wildlife capabilities、organism form、life-history 七类 simulation-owned module 组合。猞猁/野牛/浣熊继续验证 predator/herbivore/omnivore 组合；绵羊复用 open-plains + large-grazer + bovid，作为 `domesticated` form；座狼复用 forest/hills + predator + canid，作为 `monster` form。`wild/domesticated/monster` 的 species form 只确定性影响 coarse settlement/danger sensitivity，并作为 God View/Jev 的只读上下文；`domesticated` form 本身不等于个体已经被拥有，真正的 owner、tame progress、命令与繁殖许可由独立的 authoritative individual domestication state 记录。
- deterministic wildlife movement controller：movement archetype 现在不仅有 speed/energy multiplier，还定义 gait、acceleration/deceleration、turn rate 与 arrival radius。fine wildlife 通过纯 deterministic controller 逐步加速和转向，候选位移碰到 blocked cell 时不执行；God View 可查看这些 controller 语义。controller speed 属于 fine runtime 瞬时量，chunk 卸载后不持久化，远处继续由 coarse simulation 推进。
- authoritative individual domestication：`domesticated` species form 与个体驯养状态已彻底分离。绵羊个体可在第一人称中消耗真实 grain 逐步驯化，达到阈值后建立持久 owner；owner 可设置 `none/follow/stay/graze` 与繁殖许可。同 owner 且双方允许繁殖时后代可继承 ownership。`follow` 跨相邻 chunk 复用守恒 wildlife transfer 并记录 `owner_follow` provenance；进入 God View 后玩家 follow 路径立即悬置，Jev 只看到去除 owner identity 的只读驯养上下文。完整规则见 [驯养系统](domestication.md)。
- fine physics authority v1：player、NPC、wildlife 的最终位移统一由 deterministic physics authority 结算；支持 chunk-scoped static AABB、圆形 kinematic body、防穿透 substep、墙面滑移、动态角色碰撞与 non-blocking semantic trigger。旧 runtime `blocked Set` 已移除，A* passability 也查询同一 physics geometry。第一人称对象交互要求进入 physics trigger；God View 不存在 player collider。当前仍未宣称已完成 slope、door、general rigid body、stacking、projectile 等完整物理。见 [Physics](physics.md)。

## 本地运行

需要 Node.js 20+：

```bash
git clone https://github.com/ranzevor/Latticefolk.git
cd Latticefolk
cp .env.example .env
npm install
npm run dev
```

Windows 可以直接使用 `run.bat` 或 `run.ps1`。

没有 Jev Key 时游戏仍会使用本地 fallback。需要启用 Jev 时：

```dotenv
DECISION_PROVIDER=jev
TYPESAFE_API_KEY=your_server_side_key
JEV_ENDPOINT=https://api.typesafe.ai/v1/systemone
JEV_MODEL=jev-latest
```

API Key 只应存在于服务端环境变量。

## 核心原则

**决策模型负责选择意图，模拟器负责执行世界事实。**

例如 Jev 可以选择“去采矿”“向某人赠礼”“这个 chunk 采取资源保护策略”，但不能直接凭空把石料改成 999、生成不存在的人、跳过库存守恒或修改非法状态。

上帝视角同样是严格的世界外观察者：进入上帝视角后，玩家实体不会出现在 NPC 感知或 Jev 候选中。

## 开发路线

当前顺序为：✅ coarse↔fine chunk 双向转换 → ✅ SQLite 世界持久化 → ✅ 跨 chunk 守恒流 → ✅ Region / World 决策层 → ✅ 动态 chunk streaming → ✅ 语义化程序聚落 → ✅ 生产链 → ✅ 第一版生态与生命周期 → ✅ durable ancestry / evolution statistics → ✅ 环境选择压力与 biome adaptation 可观测性 → ✅ 实际观测的 lifetime habitat exposure → ✅ 可保留个体身份的 fine migration / transfer → ✅ 生态位竞争 → ✅ 季节迁徙驱动 → ✅ 更丰富的疾病传播 → ✅ fitness-by-habitat → ✅ 山羊/狼与共享 predator graph → ✅ predator-pressure adaptation observability → ✅ predator/prey specialization evidence → ✅ realized hunting/escape evidence → ✅ predator/prey trait matching + generation trends → ✅ multi-generation coevolution evidence → ✅ multi-species interaction-network observability → ✅ network-linked niche / disease source evidence → ✅ generation-level reciprocal source evidence → ✅ multi-factor interaction selection evidence → ✅ uncertainty/stability + generation-local evidence → ✅ profile-driven species/niche/morphology diversity → ✅ 可遗传 morphology/behavior phenotype + observability → ✅ deterministic phenotype→function trade-off + phenotype-by-environment fitness evidence → ✅ first constrained organism-family genome → ✅ reusable generated organism archetypes + lynx → ✅ bison/raccoon + movement/capability modules → ✅ wild/domesticated/monster forms + sheep/warg → ✅ reusable movement/controller semantics → ✅ authoritative domestication ownership/taming/commands/breeding → ✅ fine physics authority v1 / kinematic + triggers → **terrain/slope + doors + rigid bodies/projectiles**。

完整内容见 [Roadmap](roadmap.md)、[长期愿景](long-term-vision.md)、[架构](architecture.md)、[驯养系统](domestication.md)、[Physics](physics.md)、[Decision Provider](decision-providers.md)、[语料库](dialogue-library.md) 和 [国际化](i18n.md)。

## 参与贡献

欢迎新增决策 provider、交互能力、语料、翻译、世界系统、生态模型和素材适配。请先阅读 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 致谢与许可

感谢 Three.js、Quaternius、TypeSafe/Jev 以及所有贡献者。源码采用 [MIT](../LICENSE)；随仓库分发的第三方素材许可详见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。研究或演示引用可使用 [CITATION.cff](../CITATION.cff)。


不使用 GitHub Actions 的本地验证：`npm run validate:local`。执行前保存完整源码与哈希，执行后保留浏览器证据；E2E 使用独立数据库，不重置玩家正常存档。详见[本地验证边界](local-validation.md)。

烘焙 NPC 先通过正常寻路与碰撞走到模型外的工作站位再生产；版本 1 存档兼容新增可选朝向，避免重载后头部碰撞方向改变。旧存档缺省朝向仍为 +Z，无需迁移或重置。
