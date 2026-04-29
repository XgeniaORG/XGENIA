import React from 'react';
import Layout from '../../../layout';
import PointerListeners from '../../../pointerlisteners';
import { XGENIA } from '../../../types';

export interface DebugPanelVisualProps extends XGENIA.ReactProps {
  reels: Array<Array<number>>;
  winningLinesDetails: Array<{
    line: number;
    symbols: Array<number>;
    positions: Array<[number, number]>; // [row, col]
    payout: number;
  }>;
  dom;
}

interface GridLayout {
  colWidth: number;
  rowHeight: number;
  gapX: number;
  gapY: number;
}

function computeGrid(width: number, height: number, cols: number, rows: number): GridLayout {
  const gapX = Math.max(2, Math.floor(width * 0.01));
  const gapY = Math.max(2, Math.floor(height * 0.01));
  const totalGapX = gapX * Math.max(0, cols - 1);
  const totalGapY = gapY * Math.max(0, rows - 1);
  const colWidth = cols > 0 ? Math.max(16, Math.floor((width - totalGapX) / cols)) : width;
  const rowHeight = rows > 0 ? Math.max(16, Math.floor((height - totalGapY) / rows)) : height;
  return { colWidth, rowHeight, gapX, gapY };
}

function getDistinctColor(index: number, alpha = 1): string {
  const basePalette = [
    '#ef4444', // red
    '#f59e0b', // amber
    '#10b981', // emerald
    '#3b82f6', // blue
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#22c55e', // green
    '#06b6d4', // cyan
    '#eab308', // yellow
    '#f97316'  // orange
  ];
  const hex = basePalette[index % basePalette.length];
  // Convert hex to rgba with alpha
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class DebugPanelVisual extends React.Component<DebugPanelVisualProps> {
  private canvasRef = React.createRef<HTMLCanvasElement>();

  componentDidMount() {
    this.draw();
  }

  componentDidUpdate() {
    this.draw();
  }

  draw() {
    const canvas = this.canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const style = { ...this.props.style } as any;
    const parent = canvas.parentElement as HTMLElement | null;
    const parseSize = (v: any, fallback: number) => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const n = parseFloat(v);
        if (Number.isFinite(n)) return n;
      }
      return fallback;
    };
    const containerWidth = parent?.clientWidth || parseSize(style.width, 500);
    const containerHeight = parent?.clientHeight || parseSize(style.height, 320);
    const width = Math.max(100, Math.floor(containerWidth));
    const height = Math.max(100, Math.floor(containerHeight));

    const reels = (this.props as any).reels || [];
    const lines: DebugPanelVisualProps['winningLinesDetails'] = (this.props as any).winningLinesDetails || [];
    const numCols = Array.isArray(reels) ? reels.length : 0;
    const numRows = numCols > 0 ? (Array.isArray(reels[0]) ? reels[0].length : 0) : 0;

    const dpr = (window as any).devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear and background
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, width, height);

    if (!numCols || !numRows) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px sans-serif';
      ctx.fillText('No reels to display', 10, 20);
      return;
    }

    const { colWidth, rowHeight, gapX, gapY } = computeGrid(width, height - 24, numCols, numRows);

    // Draw grid cells and numbers
    for (let c = 0; c < numCols; c++) {
      for (let r = 0; r < numRows; r++) {
        const x = c * (colWidth + gapX);
        const y = r * (rowHeight + gapY);

        // Cell background
        ctx.fillStyle = (r + c) % 2 === 0 ? '#111827' : '#0b1220';
        ctx.fillRect(x, y, colWidth, rowHeight);

        // Cell border
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, colWidth - 1, rowHeight - 1);

        // Symbol text
        const symbol = reels[c] && reels[c][r] != null ? String(reels[c][r]) : '';
        ctx.fillStyle = '#e5e7eb';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(symbol, x + colWidth / 2, y + rowHeight / 2);
      }
    }

    // Build map of overlays per cell for labels stacking
    const cellToLabels: Record<string, Array<{ label: string; color: string }>> = {};

    // Draw winning lines overlays first (semi-transparent fills) and record labels
    lines.forEach((lineDetail, idx) => {
      const color = getDistinctColor(idx, 0.25);
      const solid = getDistinctColor(idx, 1);
      const positions = Array.isArray(lineDetail?.positions) ? lineDetail.positions : [];

      ctx.fillStyle = color;
      positions.forEach(([row, col]) => {
        if (col < 0 || col >= numCols || row < 0 || row >= numRows) return;
        const x = col * (colWidth + gapX);
        const y = row * (rowHeight + gapY);
        ctx.fillRect(x + 1, y + 1, colWidth - 2, rowHeight - 2);

        const key = row + ':' + col;
        if (!cellToLabels[key]) cellToLabels[key] = [];
        cellToLabels[key].push({ label: String(lineDetail.line ?? idx + 1), color: solid });
      });
    });

    // Draw connection polylines for each winning line with slight vertical offset to reduce overlap
    lines.forEach((lineDetail, idx) => {
      const solid = getDistinctColor(idx, 0.95);
      const positions = Array.isArray(lineDetail?.positions) ? lineDetail.positions : [];
      if (positions.length === 0) return;

      const offset = ((idx % 5) - 2) * Math.min(4, Math.floor(rowHeight * 0.08));
      ctx.strokeStyle = solid;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      positions.forEach(([row, col], i) => {
        const cx = col * (colWidth + gapX) + colWidth / 2;
        const cy = row * (rowHeight + gapY) + rowHeight / 2 + offset;
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
    });

    // Draw labels in each involved cell using grid packing (horizontal stacking with wrapping)
    Object.keys(cellToLabels).forEach((key) => {
      const [rowStr, colStr] = key.split(':');
      const row = Number(rowStr);
      const col = Number(colStr);
      const x = col * (colWidth + gapX);
      const y = row * (rowHeight + gapY);
      const labels = cellToLabels[key];

      if (!labels || !labels.length) return;

      const innerW = Math.max(4, colWidth - 4);
      const innerH = Math.max(4, rowHeight - 4);

      // Base sizes
      const baseFont = 10;
      const baseLH = 12; // label height
      const baseLabelWidths = labels.map((entry) => Math.min(innerW, 8 + ('#' + entry.label).length * 6));
      let uniformLW = Math.max(18, Math.min(innerW, Math.max(...baseLabelWidths)));
      let uniformLH = baseLH;

      // Determine initial columns and rows
      let colsFit = Math.max(1, Math.floor(innerW / uniformLW));
      let rowsNeeded = Math.ceil(labels.length / colsFit);

      // If doesn't fit vertically, scale down uniformly and recompute packing (iterate to converge)
      let scale = 1;
      for (let iter = 0; iter < 3; iter++) {
        if (rowsNeeded * (uniformLH * scale) <= innerH) break;
        const scaleY = innerH / (rowsNeeded * uniformLH);
        scale = Math.max(0.5, Math.min(1, scaleY));
        // Update effective sizes
        const effLW = Math.max(12, Math.floor(uniformLW * scale));
        const effLH = Math.max(8, Math.floor(uniformLH * scale));
        colsFit = Math.max(1, Math.floor(innerW / effLW));
        rowsNeeded = Math.ceil(labels.length / colsFit);
      }

      const effLW = Math.max(12, Math.floor(uniformLW * scale));
      const effLH = Math.max(8, Math.floor(uniformLH * scale));
      const effFont = Math.max(6, Math.floor(baseFont * scale));

      // Left/top padding inside cell
      const padX = 2;
      const padY = 2;

      labels.forEach((entry, i) => {
        const rowIdx = Math.floor(i / colsFit);
        const colIdx = i % colsFit;
        const lx = x + padX + colIdx * effLW;
        const ly = y + padY + rowIdx * effLH;

        // Background box with line color
        ctx.fillStyle = entry.color;
        ctx.fillRect(lx, ly, effLW - 1, effLH - 1);

        // Text
        ctx.fillStyle = '#0d1117';
        ctx.font = effFont + 'px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const text = '#' + entry.label;
        // Trim text if smaller than available width
        const approxCharW = Math.max(4, Math.floor(6 * scale));
        const maxChars = Math.max(2, Math.floor((effLW - 6) / approxCharW));
        const displayText = text.length > maxChars ? text.slice(0, Math.max(1, maxChars - 1)) + '…' : text;
        ctx.fillText(displayText, lx + 3, ly + effLH / 2);
      });
    });

    // Legend and footer info
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Cols: ${numCols} Rows: ${numRows}  Lines: ${lines.length}`, 8, height - 8);
  }

  render() {
    const style = { ...this.props.style } as any;
    Layout.size(style, this.props);
    Layout.align(style, this.props);
    if (style.opacity === 0) style.pointerEvents = 'none';

    return (
      <div className={this.props.className} {...this.props.dom} {...PointerListeners(this.props)} style={style}>
        <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
          <canvas ref={this.canvasRef} style={{ display: 'block' }} />
        </div>
      </div>
    );
  }
}


