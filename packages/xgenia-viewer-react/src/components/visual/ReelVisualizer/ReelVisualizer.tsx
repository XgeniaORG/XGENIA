import React from 'react';
import Layout from '../../../layout';
import PointerListeners from '../../../pointerlisteners';
import { XGENIA } from '../../../types';

export interface ReelVisualizerProps extends XGENIA.ReactProps {
  reelStrips: Array<Array<number>>;
  rows: number;
  stopPosList: Array<number>;
  dom;
}

interface ReelStripLayoutConfig {
  reelWidth: number;
  reelGap: number;
  symbolHeight: number;
  contentHeight: number;
  verticalOffset: number;
}

const DEBUG_PANEL_LEGEND_RESERVE = 24;
const MIN_SYMBOL_HEIGHT = 16;

function computeDebugPanelCellHeight(viewportHeight: number, rowCount: number) {
  const targetRows = Math.max(1, rowCount || 1);
  const referenceHeight = Math.max(100, Math.floor(viewportHeight));
  const gridHeight = Math.max(MIN_SYMBOL_HEIGHT, referenceHeight - DEBUG_PANEL_LEGEND_RESERVE);
  const gapY = Math.max(2, Math.floor(gridHeight * 0.01));
  const totalGapY = gapY * Math.max(0, targetRows - 1);
  const usableHeight = Math.max(MIN_SYMBOL_HEIGHT, gridHeight - totalGapY);
  return Math.max(MIN_SYMBOL_HEIGHT, Math.floor(usableHeight / targetRows));
}

function computeLayout(
  width: number,
  viewportHeight: number,
  reelsCount: number,
  maxStripLen: number
): ReelStripLayoutConfig {
  const reelGap = Math.max(2, Math.floor(width * 0.01));
  const totalGap = reelGap * Math.max(0, reelsCount - 1);
  const reelWidth = reelsCount > 0 ? Math.max(10, Math.floor((width - totalGap) / reelsCount)) : width;
  const rows = Math.max(1, maxStripLen || 1);
  const symbolHeight = computeDebugPanelCellHeight(viewportHeight || 300, rows);
  const contentHeight = symbolHeight * rows;
  const visualHeight = Math.max(50, viewportHeight || 300);
  const verticalOffset = Math.max(0, Math.floor((visualHeight - contentHeight) / 2));
  return { reelWidth, reelGap, symbolHeight, contentHeight, verticalOffset };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export class ReelVisualizer extends React.Component<ReelVisualizerProps> {
  private canvasRef = React.createRef<HTMLCanvasElement>();

  constructor(props: ReelVisualizerProps) {
    super(props);
  }

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
    const parent = canvas.parentElement as HTMLElement | null; // scroll container
    const parseSize = (v: any, fallback: number) => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const n = parseFloat(v);
        if (Number.isFinite(n)) return n;
      }
      return fallback;
    };
    const containerWidth = parent?.clientWidth || parseSize(style.width, 400);
    const containerHeight = parent?.clientHeight || parseSize(style.height, 300);
    const width = Math.max(50, Math.floor(containerWidth));
    const height = Math.max(50, Math.floor(containerHeight));

    const { reelStrips = [], rows = 3, stopPosList = [] } = (this.props as any);
    const reelsCount = Array.isArray(reelStrips) ? reelStrips.length : 0;
    const maxStripLen = reelsCount ? Math.max(...reelStrips.map((s) => (Array.isArray(s) ? s.length : 0))) : 0;

    const { reelWidth, reelGap, symbolHeight, contentHeight, verticalOffset } = computeLayout(
      width,
      height,
      reelsCount,
      maxStripLen
    );
    const displayHeight = Math.max(height, contentHeight);

    // Resize canvas for crisp drawing but keep displayed height stable
    const dpr = (window as any).devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(displayHeight * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = displayHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear full content area
    ctx.clearRect(0, 0, width, displayHeight);

    // Background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, width, displayHeight);

    if (!reelsCount || !maxStripLen) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('No reel strips', 10, Math.floor(Math.min(height, displayHeight) / 2));
      return;
    }

    // Draw each reel strip vertically
    for (let r = 0; r < reelsCount; r++) {
      const x = r * (reelWidth + reelGap);
      const strip = reelStrips[r] || [];
      const stopPos = clamp(Math.floor((stopPosList && stopPosList[r] != null) ? stopPosList[r] : -1), -1, strip.length - 1);

      // Reel background
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(x, verticalOffset, reelWidth, contentHeight);

      // Symbols
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const centerX = x + reelWidth / 2;
      for (let i = 0; i < strip.length; i++) {
        const rowY = verticalOffset + i * symbolHeight;
        // Alternate rows for readability
        ctx.fillStyle = i % 2 === 0 ? '#111827' : '#0b1220';
        ctx.fillRect(x + 1, rowY, reelWidth - 2, Math.max(1, symbolHeight - 1));

        // Text
        ctx.fillStyle = '#e5e7eb';
        ctx.font = '12px monospace';
        const label = String(strip[i]);
        ctx.fillText(label, centerX, rowY + symbolHeight / 2);
      }

      // Draw window boundaries with circular wrap
      if (rows > 0 && stopPos >= 0 && strip.length > 0) {
        const reelLen = strip.length;
        const effectiveRows = Math.min(Math.max(1, Math.floor(rows)), reelLen);
        const topIndex = ((stopPos % reelLen) + reelLen) % reelLen;

        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#f59e0b';
        ctx.setLineDash([6, 4]);

        if (topIndex + effectiveRows <= reelLen) {
          // Single rectangle, no wrap
          const windowTopY = verticalOffset + topIndex * symbolHeight;
          const windowHeight = effectiveRows * symbolHeight;
          ctx.strokeRect(x + 1, windowTopY + 1, reelWidth - 2, Math.max(1, windowHeight - 2));
        } else {
          // Wrap: draw two rectangles
          const tailCount = reelLen - topIndex;
          const headCount = effectiveRows - tailCount;

          const tailTopY = verticalOffset + topIndex * symbolHeight;
          const tailHeight = tailCount * symbolHeight;
          ctx.strokeRect(x + 1, tailTopY + 1, reelWidth - 2, Math.max(1, tailHeight - 2));

          const headTopY = verticalOffset;
          const headHeight = headCount * symbolHeight;
          ctx.strokeRect(x + 1, headTopY + 1, reelWidth - 2, Math.max(1, headHeight - 2));
        }
        ctx.restore();

        // Arrow indicator at stop position on left side
        const arrowY = verticalOffset + topIndex * symbolHeight + symbolHeight / 2;
        const arrowX = x - 4;
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX + 8, arrowY - 6);
        ctx.lineTo(arrowX + 8, arrowY + 6);
        ctx.closePath();
        ctx.fill();

        // Label stop index
        ctx.fillStyle = '#10b981';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('stop ' + topIndex, x + 4, arrowY - 8);
      }

      // Reel border
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, verticalOffset + 0.5, reelWidth - 1, Math.max(1, contentHeight - 1));
    }

    // Global legend
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Reels: ${reelsCount}   Rows: ${rows}`, 8, displayHeight - 8);
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


