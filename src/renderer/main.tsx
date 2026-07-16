import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import './styles.css';

/** Renderer 的唯一挂载点；Pet 与设置页由 App 按窗口 query 参数选择。 */
const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
