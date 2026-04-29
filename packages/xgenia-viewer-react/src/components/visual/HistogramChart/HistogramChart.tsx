import React from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

import Layout from '../../../layout';
import PointerListeners from '../../../pointerlisteners';
import { XGENIA } from '../../../types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

export interface HistogramChartProps extends XGENIA.ReactProps {
  binSize: number
  minRange?: number
  maxRange?: number
  valueList: Array<number>
  barColor?: string
  title?: string
  xLabel?: string
  yLabel?: string
}

function formatBinLabel(start: number, unit: number): string {
  const end = start + unit - 1;
  const isInteger = Number.isInteger(start) && Number.isInteger(unit);
  if (isInteger) {
    return `${start} - ${end}`;
  }
  const s = Number(start.toFixed(2));
  const e = Number(end.toFixed(2));
  return `${s} - ${e}`;
}

export class HistogramChart extends React.Component<HistogramChartProps> {
  render() {
    const {
      binSize,
      minRange,
      maxRange,
      valueList,
      barColor,
      title,
      xLabel,
      yLabel
    } = this.props as any;

    const unit = Number(binSize) > 0 ? Number(binSize) : 1;
    const min = Number.isFinite(Number(minRange)) ? Number(minRange) : 0;
    const max = Number.isFinite(Number(maxRange)) ? Number(maxRange) : 10 * unit;

    const span = Math.max(0, max - min);
    const binCount = Math.max(0, Math.ceil(span / unit));

    const labels: Array<string> = [];
    for (let i = 0; i < binCount; i++) {
      const start = min + i * unit;
      labels.push(formatBinLabel(start, unit));
    }
    const overflowLabel = `> ${Number.isInteger(max) ? max : Number(max.toFixed(2))}`;
    labels.push(overflowLabel);

    const counts: Array<number> = new Array(binCount + 1).fill(0);
    const values = Array.isArray(valueList) ? valueList : [];
    for (const v of values) {
      const value = Number(v);
      if (!Number.isFinite(value)) continue;
      if (value < min) {
        // Ignore values below minRange (no underflow bucket defined in spec)
        continue;
      } else if (value >= max) {
        counts[binCount] += 1; // overflow bucket
      } else {
        const index = Math.floor((value - min) / unit);
        const clampedIndex = Math.max(0, Math.min(binCount - 1, index));
        counts[clampedIndex] += 1;
      }
    }

    const data = {
      labels,
      datasets: [
        {
          label: 'Count',
          data: counts,
          backgroundColor: (barColor as any) || '#3498db',
          borderWidth: 0
        }
      ]
    } as any;

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
          title: { display: !!xLabel, text: xLabel || 'Range' }
        },
        y: {
          display: true,
          title: { display: !!yLabel, text: yLabel || 'Count' },
          beginAtZero: true
        }
      }
    } as any;

    const style = { ...this.props.style } as any;
    Layout.size(style, this.props);
    Layout.align(style, this.props);
    if (style.opacity === 0) style.pointerEvents = 'none';

    return (
      <div className={this.props.className} {...(this.props as any).dom} {...PointerListeners(this.props)} style={style}>
        <Bar data={data} options={options} />
      </div>
    );
  }
}


