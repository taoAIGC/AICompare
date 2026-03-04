/**
 * 统一云端 Firebase 配置（由扩展维护者填写，用户无需配置）
 * 所有用户的历史/收藏数据均同步到此项目下的 Firestore users/{uid}。
 * 扩展通过 REST API 调用 Firebase，无需在页面里引入 Firebase JS SDK 脚本。
 */
const FirebaseConfig = {
  apiKey: 'AIzaSyALR-U2AHvbSlxZ5gosp5zcobRb4KdYazo',
  authDomain: 'aicompare-12989.firebaseapp.com',
  projectId: 'aicompare-12989',
  storageBucket: 'aicompare-12989.firebasestorage.app',
  messagingSenderId: '741697777320',
  appId: '1:741697777320:web:88e1944c3d267c9f471c9d',
  measurementId: 'G-TGD1MD9XK4',
  // 谷歌登录用：Firebase 控制台 → Authentication → 登录方式 → Google → Web 客户端 ID
  googleClientId: '741697777320-9op5n3for8vl4jl8lgcd16cficu8927o.apps.googleusercontent.com',
  // Cloud Functions 部署后的 URL 前缀（firebase deploy --only functions 后可在控制台查看）
  // 格式：https://<region>-<projectId>.cloudfunctions.net
  cloudFunctionsBaseUrl: 'https://us-central1-aicompare-12989.cloudfunctions.net'
};

// 是否已配置（用于判断是否启用云端同步；REST 仅需 apiKey + projectId）
function isFirebaseConfigured() {
  return !!(FirebaseConfig.apiKey && FirebaseConfig.projectId);
}

if (typeof window !== 'undefined') {
  window.FirebaseConfig = FirebaseConfig;
  window.isFirebaseConfigured = isFirebaseConfigured;
}
