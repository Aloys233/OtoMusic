# OtoMusic 项目目录规划（当前实现）

```text
.
├── .env.example
├── docs/
│   └── PROJECT_STRUCTURE.md
├── index.html
├── package.json
├── pnpm-lock.yaml
├── postcss.config.cjs
├── src/
│   ├── App.tsx
│   ├── config/
│   │   └── env.ts
│   ├── components/
│   │   ├── layout/
│   │   │   ├── PlayerBar.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── ThemeToggle.tsx
│   │   └── ui/
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       ├── input.tsx
│   │       ├── separator.tsx
│   │       └── slider.tsx
│   ├── features/
│   │   ├── library/
│   │   │   └── hooks/
│   │   │       ├── use-album-list.ts
│   │   │       └── use-album-songs.ts
│   │   └── player/
│   │       └── utils/
│   │           └── map-subsonic-song.ts
│   ├── hooks/
│   │   └── use-dominant-color.ts
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts
│   │   │   └── subsonic-client.ts
│   │   ├── audio/
│   │   │   └── AudioEngine.ts
│   │   └── utils.ts
│   ├── main.tsx
│   ├── providers/
│   │   └── AppProviders.tsx
│   ├── stores/
│   │   ├── library-store.ts
│   │   ├── player-store.ts
│   │   └── theme-store.ts
│   ├── styles.css
│   ├── types/
│   │   ├── spark-md5.d.ts
│   │   └── subsonic.ts
│   └── vite-env.d.ts
├── src-tauri/
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs
│   │   └── main.rs
│   └── tauri.conf.json
├── tailwind.config.ts
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── 开发.txt
```

## 模块职责

- `components/layout`：应用骨架布局（Sidebar、Main Content、PlayerBar、ThemeToggle）。
- `stores`：Zustand 全局状态（主题、库状态、播放队列与播放控制）。
- `lib/audio/AudioEngine.ts`：AudioContext 单例，包含 `MasterGain` + `ReplayGain` 双节点、ReplayGain 转换、200ms fade。
- `lib/api/subsonic-client.ts`：Subsonic MD5 + salt 鉴权、专辑/歌曲查询、封面/流地址构建（`maxBitrate=0`）。
- `features/library/hooks`：TanStack Query 的专辑与歌曲缓存查询。
- `hooks/use-dominant-color.ts`：封面主色提取并驱动主内容区动态光晕。

## Tauri 窗口说明

- 当前按你的要求改为非透明窗口：`transparent: false`、`decorations: true`。
- 若后续恢复文档原始目标，再切回：`transparent: true`、`decorations: false`。
