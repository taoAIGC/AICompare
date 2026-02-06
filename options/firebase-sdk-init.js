/**
 * 使用官方 Firebase JS SDK 初始化 App 与 Analytics（仅在选项页加载）
 * 配置来自 firebaseConfig.js 的 window.FirebaseConfig
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-analytics.js';

const config = typeof window !== 'undefined' && window.FirebaseConfig;
if (config && config.apiKey && config.projectId) {
  const app = initializeApp(config);
  getAnalytics(app);
}
