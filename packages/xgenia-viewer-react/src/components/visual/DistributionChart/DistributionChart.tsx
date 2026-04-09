import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { Line } from 'react-chartjs-2';

import Layout from '../../../layout';
import PointerListeners from '../../../pointerlisteners';
import { XGENIA } from '../../../types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

export interface DistributionChartProps extends XGENIA.ReactProps {
  mean: number;
  stdDev?: number;
  variance?: number;
  amplitude?: number;
  lineColor: XGENIA.Color;
  title: string;
  xLabel: string;
  yLabel: string;
  dom;
}

function computeNormalPdf(x: number, mean: number, stdDev: number, amplitude: number): number {
  const invSqrtTwoPi = 1 / Math.sqrt(2 * Math.PI);
  const z = (x - mean) / stdDev;
  return amplitude * (invSqrtTwoPi / stdDev) * Math.exp(-0.5 * z * z);
}

export class DistributionChart extends React.Component<DistributionChartProps> {
  render() {
    const { mean = 0, stdDev, variance, amplitude, lineColor, title, xLabel, yLabel } = this.props as any;

    const s = Number(stdDev) > 0 ? Number(stdDev) : (Number(variance) > 0 ? Math.sqrt(Number(variance)) : 1);
    const A = Number(amplitude) > 0 ? Number(amplitude) : 1;

    const minX = mean - 4 * s;
    const maxX = mean + 4 * s;
    const steps = 200;
    const dx = (maxX - minX) / (steps - 1);

    const labels: Array<number> = [];
    const values: Array<number> = [];
    for (let i = 0; i < steps; i++) {
      const x = minX + i * dx;
      labels.push(Number.isFinite(x) ? Number(x.toFixed(2)) : 0);
      values.push(computeNormalPdf(x, mean, s, A));
    }

    const data = {
      labels,
      datasets: [
        {
          label: 'PDF',
          data: values,
          borderColor: (lineColor as any) || '#e67e22',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          tension: 0.1
        }
      ]
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: !!title,
          text: title,
          font: { size: 16 }
        },
        legend: { display: false }
      },
      scales: {
        x: {
          display: true,
          title: { display: !!xLabel, text: xLabel || 'X' }
        },
        y: {
          display: true,
          title: { display: !!yLabel, text: yLabel || 'Density' }
        }
      }
    };

    const style = { ...this.props.style } as any;
    Layout.size(style, this.props);
    Layout.align(style, this.props);
    if (style.opacity === 0) style.pointerEvents = 'none';

    return (
      <div className={this.props.className} {...this.props.dom} {...PointerListeners(this.props)} style={style}>
        <Line data={data} options={options} />
      </div>
    );
  }
}


