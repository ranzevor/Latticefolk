# Latticefolk

<p align="center"><img src="assets/cover.svg" alt="Latticefolk" width="100%"></p>

<p align="center"><strong>自律 NPC、町の社会、進化する世界のためのオープンソース 3D Web シミュレーション。</strong></p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <b>日本語</b> · <a href="README.es.md">Español</a></p>

Latticefolk は「会話できる NPC デモ」だけを目指していません。NPC は仕事、採集、製作、取引、贈り物、配達、水汲み、巡回、訪問、休息、睡眠、探索を行い、その結果が所持品・経済・関係・世界状態に反映されます。遠方地域も粗粒度 chunk として継続的にシミュレーションされ、意思決定 provider が地域方針に参加できます。

プロジェクトは **Jev に依存しません**。Jev / TypeSafe System One は現在の最初のリモート adapter であり、コアは汎用 `DecisionProvider` を使用します。

## 現在の主な機能

- シーン復旧では既存の樹木の成木スケール・幹アンカー、現在のスキニングによる足裏支持、有界の接触影とプレイヤー・頭部間隔、原本を保持した作物の非金属マテリアル補正を追加しています。全シーン、座位・睡眠姿勢、全体のプレイ経路の検証は未完了です。[対象範囲](environment-presentation.md)。
- Three.js の一人称 3D 町と、世界外観察者としての God View。
- 約 20 種類の bounded NPC action。
- 建物、井戸、市場、収納、荷車、木、岩、花、道具などを統一した `WorldObject + capabilities` 方式で操作。
- deterministic fallback と optional Jev provider。
- 遠方 chunk の人口・資源・生態・繁栄の粗シミュレーションと batched decision。
- God View コンソールから input-token / 日次費用 / confidence / cache / call budget を管理。
- 完全な authored line または fragment 組み合わせによる会話。
- 简体中文 / English / 日本語 / Español の UI・会話コーパス。
- Quaternius の CC0 low-poly assets。
- 永続的な野生動物系譜と進化観測。死亡・unload 後も祖先記録を SQLite に保持し、founder と実際の繁殖出生を区別、死亡原因・子孫数・繁殖成功率・世代別 trait 平均/分散/傾向を God View から確認できます。
- biome 別の選択圧観測。出生/死亡時の habitat を系譜に保存し、繁殖個体と cohort の標準化 trait 差、世代間の方向一致率、サンプル数を God View に表示します。相関を因果として断定しません。
- 生涯 habitat 曝露。個体が実際に fine simulation されている時間だけ、環境の時間加重平均、biome/chunk 滞在日数、観測された遷移を記録します。coarse 区間を個体履歴として捏造せず、出生 biome と lifetime dominant biome の選択証拠を God View で比較できます。
- 身元を保持する fine wildlife migration。名前付き個体は合法な隣接 chunk のみへ移動でき、entity ID、親、世代、traits、妊娠、habitat history を保持します。carrying capacity、coarse 数量保存、代表重み、transit persistence、移動 provenance は deterministic simulation が管理します。
- 決定論的なニッチ競争。ウサギ/シカ/イノシシ/ヤギ/キツネ/オオカミの固定 resource profile から pairwise niche overlap を計算し、他種の密度から competition pressure を導出します。圧力は effective carrying capacity と健康に有界に作用し、God View と lineage habitat exposure に記録されます。
- 季節移動ドライバ。species×biome の春夏秋冬の適性を forage・水・ecology・danger と組み合わせて seasonal suitability を計算し、隣接 habitat が 8 点以上良い場合は低強度の保存的移動を単独で駆動できます。fine wildlife も合法候補内でのみこの信号を利用します。
- より豊かな疾病伝播。coarse では環境・同種接触・異種接触・移動流入の disease pressure を分離し、fine wildlife は実際の近接個体・距離・固定の異種接触係数から伝播します。God View と lineage exposure にも疾病圧を残します。
- fitness-by-habitat エビデンス。生涯の competition、seasonal suitability、disease pressure、predator pressure と繁殖・子孫数・寿命の関連を測定します。生存中の未成熟個体は成年まで reproduction/offspring 結果から右打ち切りし、未成熟死亡は完了した非繁殖結果として保持します。標本不足や無分散では 0 ではなく推定不能として表示し、低/中/高曝露 cohort の breeder rate と trait differential を God View に示します。因果とは断定しません。
- predator-pressure 観測。実際の predator population density と共有 prey preference から各種の 0–100 捕食圧を決定論的に算出し、God View・lineage lifetime exposure・fitness evidence にのみ使います。追加の health/population 減少は行わず、実際の死亡は deterministic predation のみが処理します。
- predator/prey specialization エビデンス。coarse は predator→prey 圧力の出所分解を保持し、fine lineage は実際の観測期間だけ捕食者別の時間加重圧力を蓄積します。旧履歴に出所データがなければ 0 ではなく未知として扱い、God View では fox/wolf など捕食者別に繁殖・子孫数・寿命との関連と breeder trait differential を確認できます。
- realized hunting/escape エビデンス。deterministic fine action resolution の時だけ hunt attempt/hit/kill、flee attempt/success、attack received/survived を記録し、counterpart species 別にも保持します。Decision Provider は hunt/flee と合法な対象を選ぶだけで、成功を宣言できません。God View では命中率・撃破率・逃走成功率・被攻撃生存率と成功個体の trait differential を確認できます。
- predator/prey trait matching。実際に相互作用した個体どうしの actor−counterpart trait delta を記録し、predator は attempt/hit/kill、prey は flee attempt/escape と attack/survival で分けて集計します。paired-snapshot count を独立保持するため、古い realized outcome に trait snapshot がなくても 0 と解釈したり新しい平均を薄めたりしません。God View では最近の世代ごとの成功率と形質優位も確認できます。
- multi-generation coevolution evidence。実際の predator→prey pair ごとに predator-side と prey-side の generation series を独立保持し、異種間で同じ generation 番号を同期 cohort とみなしません。各側で realized performance、繁殖可能個体の breeder rate、offspring mean、trait mean、実際の trait advantage を結び付けます。相関は少なくとも 3 世代点、trend は 2 点以上を必要とし、証拠不足や無分散は推定不能のままです。自動的に共進化とは断定しません。
- multi-species interaction network。predation、対称な niche competition、方向付き cross-species disease transmission を読み取り専用の生態ネットワークに統合します。interaction kind ごとに独立した coverage を持ち、旧 chunk に完全な pair decomposition がなければ未知のままです。God View は bounded active window のみ、`/api/world/interactions` は永続化された discovered chunks を集計し、ネットワークは population・health・decision candidate を変更しません。
- network-linked niche / disease source evidence。fine lineage は実際の観測期間だけ、各 counterpart species の competition pressure と各 source species から対象種への disease pressure を時間加重で蓄積します。両方とも独立した observed-days 分母を持ち、旧データに pair decomposition がなければ未知のままです。God View と evolution stats は right-censoring を維持して reproduction / offspring / lifespan との関連と breeder trait differential を表示し、因果とは断定しません。
- generation-level competition / disease source evidence。各 source 関係を独立した target←source generation series として扱い、対象種自身の generation ごとに pressure、breeder/offspring、death-sample lifespan、trait trend を集計します。同じ種ペアの両側は並べて表示するだけで、同じ generation 番号を同期 cohort とみなさず reciprocal causation も自動判定しません。trend は 2 世代点以上、相関は 3 有効点以上を必要とします。
- multi-factor interaction selection evidence。reproduction / offspring / lifespan ごとに complete-case モデルを作り、十分な coverage と分散を持つ predator / competition / disease source pressure を最大 6 特徴まで扱います。legacy unknown は 0 補完しません。ridge（λ=0.25）の前に未正則化 predictor correlation matrix を診断し、行列が特異、max|rX|≥0.98、または max VIF>10 の場合は `unstable_collinearity` として β* を出力しません。安定性ゲートを通過した場合のみ God View に β*、coverage、R²、max|rX|、max VIF を表示し、因果効果とは解釈しません。
- multi-factor stability / generation-local evidence。対象種で bounded generation-omission refit を行い、履歴が 12 世代以下なら全世代、より長い場合は最古から最新まで最大 12 probe を決定論的に分散選択します。pooled model と同じ feature set を保つ推定可能な refit だけで係数範囲と符号一貫性を要約します。local evidence は最近 6 endpoint まで、各 endpoint で最大 8 generation を過去へ探索し、なお推定不能なら打ち切りを明示します。exposure は lifetime aggregate なので日単位履歴を捏造せず、異種間の generation 番号も同期しません。
- profile-driven wildlife diversity。trophic role、biome/season affinity、niche/resource use、growth/carrying capacity、fine trait baseline、feeding/hunting、life history、predation parameter、制約付き procedural morphology を simulation-owned `WildlifeSpeciesProfile` に統合しました。アナグマを真の omnivore として追加し、植物を forage しながらウサギを合法的に捕食でき、オオカミはアナグマを捕食できます。competition・disease・migration・lineage・evolution observability にも同じ profile 経路で参加します。旧 coarse save には新種を加算的に追加し、古い pressure map に新種 key がなければ unknown のまま保持して 0 を捏造しません。
- 遺伝可能 wildlife phenotype。体長/体高/脚長/頭部/尾の比率と forage・migration・risk tolerance・recovery drive を、species envelope 内の有界 phenotype として保持します。founder は entity ID から決定論的に初期化され、子は両親の中間値 + bounded deterministic mutation で継承します。形態は procedural body に反映され、behavior genes は bounded fallback threshold だけを変えます。Jev は phenotype を read-only context として受け取るだけで、genes や physiology を変更できません。lineage は birth/death phenotype と `birth` / `founder_seed` / `legacy_upgrade` provenance を保存し、legacy upgrade は歴史的 generation trend / breeder differential から除外します。
- phenotype→function trade-off。継承 phenotype は movement speed、locomotion energy、maintenance、forage efficiency、rest recovery、fast-action cost の狭い deterministic multiplier に変換されます。長い脚は速度を上げられますが移動コストも増え、大きい frame は維持コストが増えます。God View は実際に観測された lifetime dominant biome ごとに phenotype と reproduction / offspring / lifespan の関連を表示し、right-censoring を維持します。`legacy_upgrade` は現在状態の記述には使えても歴史的適応 evidence から除外されます。
- constrained organism families。現在の wildlife は lagomorph / cervid / suiform / caprine / canid / mustelid / felid / bovid / procyonid family に属し、各 fine individual は deterministic founder seed と bounded inheritance/mutation を持つ family genome を保持します。genome は material palette、既存の合法な plant niche 内の preference、stride/endurance の speed-energy trade-off を変えますが、species が持たない plant axis、prey graph、trophic role、coarse ecology を新しく作ることはできません。Jev は read-only context としてのみ参照します。lineage persistence と God View/evolution API は provenance coverage、mean/variance、generation trend、breeder differential を公開します。
- reusable generated organism archetypes。species profile は habitat、ecology/trophic niche、procedural body/family、movement mode、semantic wildlife capabilities、organism form、life-history の 7 種類の simulation-owned module から構成されます。オオヤマネコ/バイソン/アライグマに加え、ヒツジは open-plains + large-grazer + bovid を再利用する `domesticated` form、ワーグは forest/hills + predator + canid を再利用する `monster` form です。`wild/domesticated/monster` の species form 自体は coarse settlement/danger sensitivity を deterministic に定義するだけで、個体が既に所有されていることを意味しません。owner、tame progress、command、繁殖許可は別の authoritative individual domestication state として実装され、God View/Jev では境界を保って扱われます。
- deterministic wildlife movement controller。movement archetype は speed/energy multiplier に加えて gait、acceleration/deceleration、turn rate、arrival radius を定義します。fine wildlife は pure deterministic controller で段階的に加速・旋回し、blocked cell への候補移動は適用しません。God View から controller semantics を確認できます。controller speed は fine runtime の一時状態で、chunk unload 時には永続化せず、遠距離は coarse simulation が継続します。
- authoritative individual domestication。`domesticated` species form と個体の家畜化 state を分離しました。ヒツジは一人称で実際の grain を消費して tame progress を進め、閾値到達後だけ durable owner を持ちます。owner は `none/follow/stay/graze` と繁殖許可を設定でき、同一 owner かつ双方許可時の子は ownership を継承します。`follow` は隣接 chunk 間で既存の conserved wildlife transfer を使い `owner_follow` provenance を残します。God View では player-follow を停止し、Jev には owner identity を除いた read-only state だけを渡します。詳細は [Domestication](domestication.md)。
- fine physics authority v1。player / NPC / wildlife の最終 displacement は 1 つの deterministic physics authority が解決します。chunk-scoped static AABB、円形 kinematic body、anti-tunnelling substep、wall sliding、dynamic character collision、non-blocking semantic trigger を実装し、旧 runtime `blocked Set` は削除しました。A* passability も同じ physics geometry を参照し、一人称 WorldObject interaction は physics trigger overlap を必要とします。God View に player collider は存在しません。terrain/slope、door、general rigid body、stacking、projectile は次段階です。詳細は [Physics](physics.md)。

## 起動

Node.js 20+：

```bash
git clone https://github.com/ranzevor/Latticefolk.git
cd Latticefolk
cp .env.example .env
npm install
npm run dev
```

Jev Key がなくても fallback で動作します。Jev を使う場合はサーバー側の `.env` に `TYPESAFE_API_KEY` を設定してください。

## 設計原則

意思決定モデルは **意図を選択**し、シミュレーション側が **合法な状態変化を実行**します。モデルが任意の数値や存在しない事実を直接生成する設計にはしません。

God View も世界外の観察者であり、NPC の知覚対象には入りません。

## ロードマップ

✅ coarse↔fine → ✅ SQLite → ✅ conserved chunk flows → ✅ Region / World decisions → ✅ dynamic streaming → ✅ semantic procedural settlements → ✅ production chains → ✅ first lifecycle ecology → ✅ durable ancestry / evolution statistics → ✅ selection pressure / biome adaptation observability → ✅ observed lifetime habitat exposure → ✅ identity-preserving fine migration → ✅ niche competition → ✅ seasonal movement → ✅ richer disease transmission → ✅ fitness-by-habitat → ✅ goat/wolf + shared predator graph → ✅ predator-pressure adaptation observability → ✅ predator/prey specialization evidence → ✅ realized hunting/escape evidence → ✅ predator/prey trait matching + generation trends → ✅ multi-generation coevolution evidence → ✅ multi-species interaction-network observability → ✅ network-linked niche / disease source evidence → ✅ generation-level reciprocal source evidence → ✅ multi-factor interaction selection evidence → ✅ uncertainty/stability + generation-local evidence → ✅ profile-driven species/niche/morphology diversity → ✅ heritable morphology/behavior phenotype + observability → ✅ deterministic phenotype→function trade-off + phenotype-by-environment fitness evidence → ✅ first constrained organism-family genome → ✅ reusable generated organism archetypes + lynx → ✅ bison/raccoon + movement/capability modules → ✅ wild/domesticated/monster forms + sheep/warg → ✅ reusable movement/controller semantics → ✅ authoritative domestication ownership/taming/commands/breeding → ✅ fine physics authority v1 / kinematic + triggers → **terrain/slope + doors + rigid bodies/projectiles**。

詳細は [Roadmap](roadmap.md)、[Architecture](architecture.md)、[Domestication](domestication.md)、[Physics](physics.md) を参照してください。

## 貢献・ライセンス

[CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。コードは [MIT](../LICENSE)。同梱アセットのライセンスは [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) に記録しています。引用情報は [CITATION.cff](../CITATION.cff) にあります。


GitHub Actions を使わないローカル検証は `npm run validate:local` です。実行前のソースとハッシュ、実行後のブラウザー証跡を保持し、通常のセーブとは別の E2E データベースを使用します。[検証範囲](local-validation.md)。

パン職人は物理的な移動で炉の外側の作業位置に到達してから生産します。NPC の向きはバージョン 1 セーブの任意項目として保持され、旧セーブでは従来の +Z を使用します。テーブル移行やリセットは不要です。
