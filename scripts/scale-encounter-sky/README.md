# 天空场景独立预览

从本任务 worktree 根目录运行：

```sh
node scripts/scale-encounter-sky/serve-preview.mjs
```

脚本只构建天空专属 prototype，并严格绑定 `127.0.0.1:4188`。如果端口已被
占用，Vite 会直接失败，不会改用 4187 或其它场景端口。

本地 server 仅把 direct-scale 基线中的两个冻结 base Avatar GLB 以只读路由提供给
统一 Avatar runtime。启动时会先核验男女文件 SHA-256；没有复制任何 Avatar 或服饰。
