# Food Review Agent

一个以 **AI 参谋智能体** 为核心的个人美食点评应用。你可以把它当作自己的美食“决策中枢”：记录自己的每一次美食体验，并与 AI Agent 进行对话获取就餐建议。

## AI 参谋智能体

- **点评知识注入**：智能体可根据你的历史点评以及所有用户的点评，给出更个性化建议
- **接入地图工具**：智能体接入高德接口提供实时、准确的餐馆信息，并给出到店交通指引与路线建议
- **流式对话**：前端通过 SSE 实时展示 AI 输出


## 其他功能

- 用户注册/登录（JWT）
- 点评 CRUD（搜索、排序）
- 图片/视频附件上传
- 区域与地点建议
- Android 容器打包（Capacitor）

## 技术栈

- 后端：Python 3.10+、FastAPI、SQLAlchemy、Uvicorn
- 安全：JWT（`python-jose`）+ 密码哈希（`passlib[bcrypt]`）
- AI：LangChain / LangGraph
- 前端：React 18 + TypeScript + Vite 5
- 移动端：Capacitor Android

## 目录结构

```text
.
├── app/
│   ├── routers/                # auth/reviews/ai/uploads/...
│   ├── agent.py                # AI 参谋智能体
│   ├── models.py
│   ├── schemas.py
│   ├── config.py
│   └── main.py
├── frontend/
├── data/
├── .env.example
└── run_server.sh
```

## 快速开始

### 1) 配置环境变量

```bash
cp .env.example .env
```

关键变量：

- `APP_ENV`: `development` / `staging` / `production`
- `SECRET_KEY`: 必填，长度至少 32
- `CORS_ORIGINS`: 前端来源白名单（逗号分隔，禁止 `*`）
- `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`
- `AMAP_KEY`（若使用地图能力）

生成随机密钥示例：

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 2) 构建前端

```bash
cd frontend
npm install
npm run build
```

执行后会生成目录 `static/`。

可选：如果你要同步更新 Android 工程，可继续执行：

```bash
npm run cap:sync
npm run cap:open
```

### 3) 启动后端

先回到项目根目录，再执行：

```bash
cd ..
uv sync
./run_server.sh
```

启动后访问：`http://127.0.0.1:5255`

### 4) 前端开发模式（可选）

如果你在做前端联调或开发，使用 Vite 开发服务器：

```bash
cd frontend
npm run dev
```

前端开发地址：`http://127.0.0.1:5173`。
