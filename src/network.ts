export type NodeKind = 'reservoir' | 'gate' | 'junction' | 'outlet';
export type Status = 'normal' | 'watch' | 'alert';

export interface HydroNode {
  id: string;
  label: string;
  kind: NodeKind;
  position: [number, number, number];
  level: number;
  status: Status;
}

export interface HydroLink {
  id: string;
  label: string;
  from: string;
  to: string;
  points: Array<[number, number, number]>;
  width: number;
  depth: number;
  flow: number;
  velocity: number;
  level: number;
  status: Status;
}

export interface HydroNetwork {
  nodes: HydroNode[];
  links: HydroLink[];
}

/**
 * Demo topology deliberately carries visible world-space elevation.
 * The first prototype kept every Y value around 0.1, which made an otherwise
 * Three.js scene read like a flat map. Here the water surface falls from the
 * upstream reservoir toward three downstream irrigation areas while each
 * branch keeps small local undulations for an organic Sylva-like silhouette.
 */
export const network: HydroNetwork = {
  nodes: [
    { id: 'R-01', label: '上游水库', kind: 'reservoir', position: [-7.2, 1.72, 0.15], level: 483.2, status: 'normal' },
    { id: 'G-01', label: '总干渠闸门', kind: 'gate', position: [-4.75, 1.50, 0.0], level: 475.8, status: 'normal' },
    { id: 'J-01', label: '一级分水节点', kind: 'junction', position: [-1.7, 1.28, -0.1], level: 467.4, status: 'normal' },
    { id: 'J-02', label: '北干渠分水节点', kind: 'junction', position: [1.25, 1.03, -2.05], level: 458.1, status: 'normal' },
    { id: 'O-01', label: '北部灌区', kind: 'outlet', position: [6.65, 0.54, -3.15], level: 442.7, status: 'normal' },
    { id: 'J-03', label: '主干渠调度节点', kind: 'junction', position: [1.55, 1.00, 0.05], level: 457.6, status: 'watch' },
    { id: 'O-02', label: '东部灌区', kind: 'outlet', position: [7.0, 0.48, 0.1], level: 439.3, status: 'normal' },
    { id: 'J-04', label: '南干渠分水节点', kind: 'junction', position: [2.05, 0.78, 2.05], level: 454.9, status: 'normal' },
    { id: 'O-03', label: '南部灌区', kind: 'outlet', position: [6.55, 0.30, 3.55], level: 438.6, status: 'alert' },
  ],
  links: [
    {
      id: 'C-01', label: '总干渠 A 段', from: 'R-01', to: 'G-01', width: 1.02, depth: 0.30,
      flow: 42.6, velocity: 1.45, level: 479.8, status: 'normal',
      points: [[-7.2, 1.68, 0.15], [-6.55, 1.64, -0.28], [-5.52, 1.56, 0.32], [-4.75, 1.47, 0.0]],
    },
    {
      id: 'C-02', label: '总干渠 B 段', from: 'G-01', to: 'J-01', width: 0.90, depth: 0.27,
      flow: 40.8, velocity: 1.53, level: 470.5, status: 'normal',
      points: [[-4.75, 1.47, 0.0], [-3.85, 1.45, 0.48], [-2.62, 1.35, -0.52], [-1.7, 1.25, -0.1]],
    },
    {
      id: 'C-N1', label: '北干渠上段', from: 'J-01', to: 'J-02', width: 0.63, depth: 0.21,
      flow: 13.7, velocity: 1.12, level: 462.0, status: 'normal',
      points: [[-1.7, 1.25, -0.1], [-0.72, 1.22, -0.78], [0.18, 1.10, -1.72], [1.25, 1.00, -2.05]],
    },
    {
      id: 'C-N2', label: '北干渠下段', from: 'J-02', to: 'O-01', width: 0.50, depth: 0.17,
      flow: 12.9, velocity: 1.06, level: 449.6, status: 'normal',
      points: [[1.25, 1.00, -2.05], [2.25, 0.94, -1.60], [3.20, 0.86, -2.90], [4.65, 0.72, -2.42], [5.55, 0.62, -3.52], [6.65, 0.51, -3.15]],
    },
    {
      id: 'C-M1', label: '主干渠中段', from: 'J-01', to: 'J-03', width: 0.76, depth: 0.24,
      flow: 27.1, velocity: 1.34, level: 461.2, status: 'watch',
      points: [[-1.7, 1.25, -0.1], [-0.65, 1.20, 0.46], [0.55, 1.09, -0.38], [1.55, 0.97, 0.05]],
    },
    {
      id: 'C-E1', label: '东干渠', from: 'J-03', to: 'O-02', width: 0.55, depth: 0.18,
      flow: 15.2, velocity: 1.18, level: 447.8, status: 'normal',
      points: [[1.55, 0.97, 0.05], [2.55, 0.91, 0.68], [3.78, 0.80, -0.54], [4.96, 0.68, 0.62], [5.98, 0.57, -0.28], [7.0, 0.45, 0.1]],
    },
    {
      id: 'C-S1', label: '南干渠上段', from: 'J-03', to: 'J-04', width: 0.53, depth: 0.18,
      flow: 11.6, velocity: 0.92, level: 456.2, status: 'normal',
      points: [[1.55, 0.97, 0.05], [1.05, 0.93, 0.72], [2.55, 0.85, 1.15], [2.05, 0.75, 2.05]],
    },
    {
      id: 'C-S2', label: '南干渠下段', from: 'J-04', to: 'O-03', width: 0.45, depth: 0.16,
      flow: 10.9, velocity: 1.62, level: 444.1, status: 'alert',
      points: [[2.05, 0.75, 2.05], [3.05, 0.68, 2.62], [3.92, 0.58, 1.98], [4.85, 0.49, 3.14], [5.62, 0.39, 2.82], [6.55, 0.27, 3.55]],
    },
  ],
};
