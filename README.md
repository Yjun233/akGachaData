# 明日方舟寻访数据站

**在线地址：<https://yjun233.github.io/akGachaData/>**

展示《明日方舟》**标准寻访 / 中坚寻访 / 限定寻访**的干员与卡池信息，并提供统计：
每位干员的**出率提升次数、商店兑换次数、最后一次 UP 的结束时间与距今天数**。

支持把「参考日期」设为过去任意一天 —— 所有统计都会自动屏蔽尚未开始的卡池并重新计算。

## 四个页面

| 路径 | 内容 |
| --- | --- |
| `/` | **卡池一览**：可按寻访类型 / 大类 / 日期 / 干员名筛选 |
| `/operators` | **出率提升记录**：干员的 UP 次数与商店兑换次数（六星 / 五星 × 标准 / 中坚） |
| `/shop-interval` | **首次进店间隔**：相邻两次进店隔了多久，看轮换节奏 |
| `/up-history` | **UP 历史一览**：横向时间轴，看每位干员的出率提升历史 |

## 快速开始

```bash
pnpm install        # 没装 pnpm 可用 npx --yes pnpm@9 install
pnpm dev            # http://127.0.0.1:5173
pnpm build          # 构建到 dist/（纯静态，约 757 KB）
```

> **开发默认读本地**：`public/data`、`public/avatars` 是指向同级 `akGachaResource` 仓库的目录联接，
> 所以本地改完数据不用推送就能看到效果（首次拿到仓库后需要建这两个联接，见资源仓库的 README）。
> 想看**线上**数据（jsDelivr CDN）用 `VITE_RESOURCE=cdn pnpm dev`。
> **构建产物一律走 CDN** —— `dist/` 里不含任何数据或图片。

## 数据从哪来

数据与头像**不在本仓库**，在独立仓库 **[akGachaResource](https://github.com/Yjun233/akGachaResource)**，
浏览器通过 jsDelivr CDN 直接读取：

```
https://cdn.jsdelivr.net/gh/Yjun233/akGachaResource@main/data/operators.json
https://cdn.jsdelivr.net/gh/Yjun233/akGachaResource@<sha>/avatars/char_306_leizi.png
```

所以站点的构建产物里不含任何数据或图片。

- **卡池 / 干员数据**：**国服**抓取自 [PRTS Wiki](https://prts.wiki/)、**国际服**抓取自
  [arknights.wiki.gg](https://arknights.wiki.gg/)、**繁中服**由人工维护的表格生成
- **干员头像**：来自 [ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource)，
  已压缩到 96×96

想直接用这些数据的话，看 [akGachaResource 的 README](https://github.com/Yjun233/akGachaResource)。

## 技术栈

Vue 3 + Vite + Vue Router + Pinia + ECharts。

## 声明

本站点是个人非商业的数据整理项目。《明日方舟》相关素材与数据的著作权归上海鹰角网络科技有限公司所有。
数据来源为 PRTS Wiki 与 arknights.wiki.gg（均为玩家共建 Wiki），繁中服数据来自人工整理的卡池记录表。
