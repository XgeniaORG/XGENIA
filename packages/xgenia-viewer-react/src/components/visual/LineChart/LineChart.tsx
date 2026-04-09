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

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

export interface LineChartProps extends XGENIA.ReactProps {
  dataset: number[];
  lineColor: XGENIA.Color;
  title: string;
  xLabel: string;
  yLabel: string;
  dom;
}

export class LineChart extends React.Component<LineChartProps> {
  constructor(props: LineChartProps) {
    super(props);
  }

  render() {
    const { dataset, lineColor, title, xLabel, yLabel } = this.props;

    // Process dataset - prioritize inputted dataset over default
    let chartData;
    if (dataset && Array.isArray(dataset) && dataset.length > 0) {
      chartData = {
        labels: dataset.map((_, index) => index + 1),
        datasets: [{
          label: 'Data',
          data: dataset,
          borderColor: lineColor || '#3498db',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          fill: false,
          tension: 0.1
        }]
      };
    } else {
      // Default data
      chartData = {
        labels: [1, 2, 3, 4, 5],
        datasets: [{
          label: 'Data',
          data: [10, 20, 30, 40, 50],
          borderColor: lineColor || '#3498db',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          fill: false,
          tension: 0.1
        }]
      };
    }

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: !!title,
          text: title,
          font: {
            size: 16
          }
        },
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          display: true,
          title: {
            display: !!xLabel,
            text: xLabel || 'X Axis'
          }
        },
        y: {
          display: true,
          title: {
            display: !!yLabel,
            text: yLabel || 'Y Axis'
          }
        }
      }
    };

    const style = { ...this.props.style };
    Layout.size(style, this.props);
    Layout.align(style, this.props);

    if (style.opacity === 0) {
      style.pointerEvents = 'none';
    }

    return (
      <div className={this.props.className} {...this.props.dom} {...PointerListeners(this.props)} style={style}>
        <Line data={chartData} options={options} />
      </div>
    );
  }
} 