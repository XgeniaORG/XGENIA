import React from 'react';
import Layout from '../../../layout';
import PointerListeners from '../../../pointerlisteners';
import { XGENIA } from '../../../types';
import ReactJson from '@microlink/react-json-view';

export interface DictViewerProps extends XGENIA.ReactProps {
  data: Record<string, unknown> | any;
  dom;
}

export class DictViewer extends React.Component<DictViewerProps> {
  render() {
    const style = { ...this.props.style } as React.CSSProperties;
    Layout.size(style, this.props);
    Layout.align(style, this.props);

    if ((style as any).opacity === 0) {
      (style as any).pointerEvents = 'none';
    }

    return (
      <div className={this.props.className} {...this.props.dom} {...PointerListeners(this.props)} style={style}>
        <ReactJson
          name={null}
          src={this.props.data ?? {}}
          collapsed={false}
          enableClipboard={false}
          displayDataTypes={false}
          displayObjectSize={false}
          theme="rjv-default"
        />
      </div>
    );
  }
} 