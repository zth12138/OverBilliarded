import { coarseShots, generateRoutes, searchPlans } from './search';
import { gpuScreen } from './gpu-search';
import { POCKETS } from './physics';
import type { SearchRequest, SearchUpdate } from './types';

self.onmessage = async (event: MessageEvent<SearchRequest>) => {
  const request = event.data, start = performance.now();
  const send = (update: SearchUpdate) => self.postMessage(update);
  const backend = (value: 'cpu' | 'gpu', message: string) => send({ type: 'backend', id: request.id, backend: value, message });
  let checked = 0;
  try {
    const valid = request.balls.some(b => b.id === 0 && !b.pocketed)
      && request.balls.some(b => b.id === request.target && !b.pocketed)
      && !!POCKETS[request.pocket] && !request.rules.breakShot;
    let prepared: Parameters<typeof searchPlans>[2];
    if (request.useGpu && valid) {
      backend('gpu', '正在初始化 GPU 轨迹试算…');
      const grids = generateRoutes(request).map(route => ({ route, shots: coarseShots(route, request) }));
      if (grids.length) {
        const result = await gpuScreen(request, grids, (done, total) => {
          backend('gpu', `GPU 轨迹试算 ${done} / ${total} 组`);
        });
        if (result.ok) {
          prepared = result.grids;
          backend('gpu', `GPU 已试算 ${result.tested} 组，保留 ${result.retained} 组进行精确验证`);
        } else backend('cpu', `已回退 CPU：${result.reason}`);
      } else backend('cpu', '未生成候选路线，使用 CPU 搜索');
    } else backend('cpu', '使用原 CPU 搜索');
    // Hold the terminal update until the optional recovery pass has finished.
    const run = (grids?: Parameters<typeof searchPlans>[2]) => {
      const offset = checked;
      return searchPlans(request, update => {
        if (update.type === 'done') checked = offset + update.checked;
        else if (update.type === 'progress') send({ ...update, checked: offset + update.checked, total: offset + update.total });
      }, grids);
    };
    let plans = run(prepared);
    if (prepared && !plans.length) {
      backend('cpu', 'GPU 候选未通过精确验证，正在用完整 CPU 搜索补查');
      plans = run();
    }
    send({ type: 'done', id: request.id, plans, checked, elapsed: performance.now() - start });
  } catch (error) { send({ type: 'error', id: request.id, message: String(error) }); }
};
