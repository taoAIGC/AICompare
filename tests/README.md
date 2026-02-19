# AI Compare Chrome Extension - 测试套件

本测试套件使用 Playwright 为 AI Compare Chrome 扩展提供全面的测试覆盖。

## 测试结构

```
tests/
├── setup.js              # 测试基础设置和工具类
├── utils/
│   └── test-utils.js     # 测试实用工具函数
├── fixtures/
│   └── test-data.json    # 测试数据
├── unit/                 # 单元测试
│   └── config.test.js    # 配置解析测试
├── integration/          # 集成测试
│   └── storage.test.js   # 存储和消息通信测试
├── ui/                  # UI测试
│   └── components.test.js # 组件测试
└── e2e/                 # E2E测试
    └── user-flows.test.js # 用户流程测试
```

## 测试类型

### 单元测试 (unit)
- 配置解析和验证
- 工具函数测试
- URL验证、时间格式化等

### 集成测试 (integration)
- Chrome Storage API 测试
- 消息通信测试
- 跨上下文交互测试

### UI测试 (ui)
- 浮窗按钮组件测试
- 文本选择功能测试
- 搜索按钮组件测试
- 样式和布局测试

### E2E测试 (e2e)
- 完整用户操作流程
- 多站点比较流程
- 收藏和历史功能

## 安装依赖

```bash
npm install
```

## 运行测试

### 运行所有测试
```bash
npm test
```

### 运行特定类型的测试
```bash
# 单元测试
npm run test:unit

# 集成测试
npm run test:integration

# E2E测试
npm run test:e2e

# UI测试
npm run test:ui
```

### 调试模式
```bash
# 有头模式（显示浏览器）
npm run test:headed

# 调试模式
npm run test:debug
```

### 生成报告
```bash
npm run test:report
```

## 环境变量

- `CI=true` - 在CI环境中运行，会启用无头模式和重试
- `HEADLESS=false` - 禁用无头模式

## 扩展测试注意事项

由于Chrome扩展的特殊性，测试需要注意以下几点：

1. **扩展上下文**：测试需要在扩展的上下文中运行
2. **权限限制**：某些Chrome API需要正确的权限配置
3. **跨域限制**：iframe测试需要处理跨域问题

## 扩展结构验证

测试套件会自动验证扩展文件结构，确保所有必需文件存在：

- manifest.json
- background.js
- iframe/iframe.html
- options/options.html
- homepage/homepage.html
- history/history.html
- favorites/favorites.html
