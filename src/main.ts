import './style.css';
import { HydroFlowScene } from './HydroFlowScene';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('HydroFlow: #scene canvas not found');

const app = new HydroFlowScene(canvas);

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
