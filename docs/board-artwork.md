# 原版棋盘美术

两张地图使用 `docs/mildmile.png` 和 `docs/wildwilds.png` 中的印刷插画。生成脚本按四角坐标校正插画、特殊格、起点、领奖台与数字，去掉照片中的桌布、卡牌和起点立牌。格子、圆角边框、白色轮廓和折痕由 Canvas 重绘；Three.js 保留实体棋盘厚度、立体角色、骰子和阴影。

`trackLayout.ts` 是印刷层、2D 棋子与 3D 棋子共用的坐标来源：起点占上边三个格宽，1–12 格沿上边，13–14 格沿右边，15–29 格沿下边，30 为左侧领奖区。特殊格编号与服务端 `build_wild_wilds` 一致。

重新生成素材（需要 Python 3、Pillow、NumPy）：

```sh
python3 apps/web/scripts/build-board-atlas.py
```

生成 `apps/web/public/assets/boards/print-atlas.webp` 和 `apps/web/src/components/race3d/boardAtlas.json`。两张地图共用一份图集，运行时不依赖 Python。加载失败时保留带特殊格文字的简化棋盘。

启动前端开发服务后，打开 `/MagicalAthleteOL/race3d-preview.html`。可切换两张地图、立体/俯视视图以及棋子显示。比赛以全屏三维场景展示，竖屏默认显示局部棋盘。镜头平滑跟随移动、技能和待选决策，也可切换到全局视角。比分、掷骰和镜头控制悬浮显示，角色卡可展开查看。预览提供移动和技能特写按钮。

目前的参考素材是有透视的实拍照片，插画细节仍受原照片清晰度、光照和局部透视影响。这是按现有素材制作的原版外观还原，不能视为像素级的原始印刷文件复刻。获得无透视的高清扫描后，可替换图集内容而无需改变赛道逻辑。
