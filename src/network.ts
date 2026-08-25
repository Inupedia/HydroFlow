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
  flow: number;
  velocity: number;
  level: number;
  status: Status;
}

export interface HydroNetwork {
  nodes: HydroNode[];
  links: HydroLink[];
}

export const network: HydroNetwork = {
  nodes: [
    { id: 'R-01', label: '上游水库', kind: 'reservoir', position: [-7.2, 0.22, 0.15], level: 483.2, status: 'normal' },
    { id: 'G-01', label: '总干渠闸门', kind: 'gate', position: [-4.75, 0.18, 0.0], level: 475.8, status: 'normal' },
    { id: 'J-01', label: '一级分水节点', kind: 'junction', position: [-1.7, 0.16, -0.1], level: 467.4, status: 'normal' },
    { id: 'J-02', label: '北干渠分水节点', kind: 'junction', position: [1.25, 0.15, -2.05], level: 458.1, status: 'normal' },
    { id: 'O-01', label: '北部灌区', kind: 'outlet', position: [6.65, 0.12, -3.15], level: 442.7, status: 'normal' },
    { id: 'J-03', label: '主干渠调度节点', kind: 'junction', position: [1.55, 0.14, 0.05], level: 457.6, status: 'watch' },
    { id: 'O-02', label: '东部灌区', kind: 'outlet', position: [7.0, 0.10, 0.1], level: 439.3, status: 'normal' },
    { id: 'J-04', label: '南干渠分水节点', kind: 'junction', position: [2.05, 0.13, 2.05], level: 454.9, status: 'normal' },
    { id: 'O-03', label: '南部灌区', kind: 'outlet', position: [6.55, 0.08, 3.55], level: 438.6, status: 'alert' },
  ],
  links: [
    {
      id: 'C-01', label: '总干渠 A 段', from: 'R-01', to: 'G-01', width: 0.92,
      flow: 42.6, velocity: 1.45, level: 479.8, status: 'normal',
      points: [[-7.2, 0.18, 0.15], [-6.55, 0.17, -0.28], [-5.52, 0.16, 0.32], [-4.75, 0.15, 0.0]],
    },
    {
      id: 'C-02', label: '总干渠 B 段', from: 'G-01', to: 'J-01', width: 0.82,
      flow: 40.8, velocity: 1.53, level: 470.5, status: 'normal',
      points: [[-4.75, 0.15, 0.0], [-3.85, 0.14, 0.48], [-2.62, 0.14, -0.52], [-1.7, 0.13, -0.1]],
    },
    {
      id: 'C-N1', label: '北干渠上段', from: 'J-01', to: 'J-02', width: 0.55,
      flow: 13.7, velocity: 1.12, level: 462.0, status: 'normal',
      points: [[-1.7, 0.13, -0.1], [-0.72, 0.12, -0.78], [0.18, 0.12, -1.72], [1.25, 0.12, -2.05]],
    },
    {
      id: 'C-N2', label: '北干渠下段', from: 'J-02', to: 'O-01', width: 0.43,
      flow: 12.9, velocity: 1.06, level: 449.6, status: 'normal',
      points: [[1.25, 0.12, -2.05], [2.25, 0.11, -1.60], [3.20, 0.11, -2.90], [4.65, 0.10, -2.42], [5.55, 0.10, -3.52], [6.65, 0.10, -3.15]],
    },
    {
      id: 'C-M1', label: '主干渠中段', from: 'J-01', to: 'J-03', width: 0.68,
      flow: 27.1, velocity: 1.34, level: 461.2, status: 'watch',
      points: [[-1.7, 0.13, -0.1], [-0.65, 0.12, 0.46], [0.55, 0.12, -0.38], [1.55, 0.11, 0.05]],
    },
    {
      id: 'C-E1', label: '东干渠', from: 'J-03', to: 'O-02', width: 0.48,
      flow: 15.2, velocity: 1.18, level: 447.8, status: 'normal',
      points: [[1.55, 0.11, 0.05], [2.55, 0.10, 0.68], [3.78, 0.10, -0.54], [4.96, 0.09, 0.62], [5.98, 0.09, -0.28], [7.0, 0.09, 0.1]],
    },
    {
      id: 'C-S1', label: '南干渠上段', from: 'J-03', to: 'J-04', width: 0.46,
      flow: 11.6, velocity: 0.92, level: 456.2, status: 'normal',
      points: [[1.55, 0.11, 0.05], [1.05, 0.10, 0.72], [2.55, 0.10, 1.15], [2.05, 0.10, 2.05]],
    },
    {
      id: 'C-S2', label: '南干渠下段', from: 'J-04', to: 'O-03', width: 0.38,
      flow: 10.9, velocity: 1.62, level: 444.1, status: 'alert',
      points: [[2.05, 0.10, 2.05], [3.05, 0.09, 2.62], [3.92, 0.09, 1.98], [4.85, 0.08, 3.14], [5.62, 0.08, 2.82], [6.55, 0.08, 3.55]],
    },
  ],
};
