import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router/index.js';
import { installDatePaste } from './lib/datePaste.js';
import './styles/main.css';

/* 日期框的**粘贴增强**（2026-10-30 用户要求）：让 `<input type="date">` 能吃下
   「2026-10-29」这类文本，以及整段复制出来的卡池信息（取第一个 / 最后一个日期）。
   实现在 `lib/datePaste.js`，挂一次即可（幂等）。 */
installDatePaste();

createApp(App).use(createPinia()).use(router).mount('#app');
