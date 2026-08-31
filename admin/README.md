# Paws Paths 运营后台

独立 Web 应用，用于审核举报工单、查看审计日志等运营管理任务。

## 技术栈

- **框架**: React 18 + TypeScript
- **构建工具**: Vite 5
- **路由**: React Router 6
- **样式**: 原生 CSS（无 UI 框架依赖）

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器（默认端口 5173）
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

## 配置

### 后端 API 代理

开发模式下，Vite 会将 `/api/*` 请求代理到 `http://localhost:3000`（后端服务）。

生产环境需要配置 Nginx 或其他反向代理：

```nginx
location /api/ {
  proxy_pass http://backend:3000/;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```

### CORS 配置

后端需要配置 `ADMIN_ORIGINS` 环境变量允许前端域名：

```bash
# 开发环境
ADMIN_ORIGINS=http://localhost:5173

# 生产环境
ADMIN_ORIGINS=https://admin.paws-paths.example.com
```

## 功能

### 已实现

- ✅ 密码登录（JWT 认证）
- ✅ 待审核工单列表
- ✅ 批准/驳回操作
- ✅ 角色菜单控制（审核员 vs 管理员）
- ✅ 自动刷新 token 过期跳转登录

### 开发中

- 🚧 审计日志查询（管理员）
- 🚧 工单分页、筛选、排序
- 🚧 举报内容预览（图片/动态）

## 项目结构

```
admin/
├── src/
│   ├── lib/           # 工具库
│   │   ├── auth.ts    # 认证状态管理（localStorage）
│   │   └── api.ts     # API 客户端（Bearer token）
│   ├── components/    # 通用组件
│   │   ├── Layout.tsx # 侧边栏布局
│   │   └── ProtectedRoute.tsx # 路由守卫
│   ├── pages/         # 页面组件
│   │   ├── Login.tsx  # 登录页
│   │   └── Reports.tsx # 工单列表
│   ├── App.tsx        # 路由配置
│   └── main.tsx       # 入口文件
├── index.html
├── vite.config.ts
└── package.json
```

## 安全特性

- **无密码明文传输**: HTTPS 强制（生产环境）
- **JWT 无角色嵌入**: 每次请求从数据库取新鲜角色（Global Constraint 28）
- **自动登出**: 401 响应触发清空 token + 跳转登录
- **CORS 限制**: 后端只允许显式配置的域名跨域

## 部署清单

1. 构建前端: `npm run build` → `dist/` 目录
2. 部署静态文件到 Nginx/CDN
3. 配置反向代理: `/api/` → 后端服务
4. 后端设置 `ADMIN_ORIGINS` 环境变量
5. 使用 CLI 创建管理员账号: `npm run admin:create`
