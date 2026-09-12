import { NodeGraphContextTmp } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import React, { useState, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';

import { RouterAdapter } from '../../../../models/NodeTypeAdapters/RouterAdapter';
import { ProjectModel } from '../../../../models/projectmodel';
import PopupLayer from '../../../popuplayer';
import * as NewPopupLayer from '../../../PopupLayer/index';
import { ToastLayer } from '../../../ToastLayer/ToastLayer';

// Styles
require('../../../../styles/propertyeditor/pages.css');

function CreateNewPage(props) {
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef(null);

  const onCreateNewPage = () => {
    const name = inputRef.current.value;

    if (!name) return;

    props.onCreateNewPage(name);
  };

  if (isCreating) {
    return (
      <>
        <div className="variants-header">
          <span>New page name</span>
        </div>
        <div className="variants-input-container">
          <input
            autoFocus
            className="variants-input"
            ref={inputRef}
            onKeyUp={(e) => e.key === 'Enter' && onCreateNewPage()}
          />
          <button className="variants-button primary" onClick={onCreateNewPage}>
            Create
          </button>
        </div>
      </>
    );
  } else {
    return (
      <div className="variants-header variants-add-header">
        <span>Create new page</span>
        <IconButton
          icon={IconName.Plus}
          size={IconSize.Small}
          UNSAFE_className="add-button"
          variant={IconButtonVariant.OpaqueOnHover}
          onClick={() => setIsCreating(true)}
        />
      </div>
    );
  }
}

function PageItem(props) {
  return (
    <div className="variants-pick-variant-item is-page" onClick={props.onSelectClicked}>
      <div className="variants-pick-variant-inner">
        <div className="router-pages-icon" style={{ margin: '0px', marginLeft: '7px' }}></div>
        <div className="variant-item-name" style={{ marginRight: '7px' }}>
          {props.name}
        </div>
      </div>
    </div>
  );
}

function AddNewPagePopup(props) {
  return (
    <div style={{ width: '230px', height: '400px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ overflow: 'hidden auto', flexGrow: 1 }}>
        <CreateNewPage onCreateNewPage={props.onCreateNewPage} />

        {/*
          Labelled, and with an explicit empty state: the pages already attached to this
          router are filtered out of this list, so "nothing here" is a normal outcome and
          has to be distinguishable from the list having failed to build.
        */}
        <div className="variants-header">
          <span>Add an existing page</span>
        </div>

        {props.pages.length === 0 ? (
          <div className="router-pages-label">Every page in this project is already in this router.</div>
        ) : (
          props.pages.map((p) => (
            <PageItem
              name={p.title || p.component}
              key={p.title || p.component}
              onSelectClicked={() => props.onPageSelected(p)}
            ></PageItem>
          ))
        )}
      </div>
    </div>
  );
}

function BigPageItem(props) {
  const popupAnchor = useRef(null);

  const p = props.page;

  return (
    <div style={{ display: 'flex', width: '100%' }}>
      <div className="router-pages-page" onClick={props.onPageClicked}>
        <div style={{ display: 'flex' }}>
          <div className={'router-pages-icon' + (props.isStartPage ? ' start-page' : '')}></div>
        </div>
        {/* minWidth: 0 lets the long page paths ellipsize instead of forcing the row wider */}
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div className="router-pages-component">{p.title || p.component}</div>
          <div className="router-pages-path">{p.path}</div>
        </div>
        <div style={{ display: 'flex' }}>
          <div
            className="router-pages-actions-icon"
            ref={popupAnchor}
            onClick={(evt) => props.onPageActionsClicked(popupAnchor.current, evt)}
          >
            <i className="fa fa-ellipsis-h"></i>
          </div>
        </div>
      </div>
    </div>
  );
}

export class Pages extends React.Component {
  constructor(props) {
    super(props);

    // @ts-expect-error
    this.value = this.props.value || {};

    this.state = {
      // @ts-expect-error
      pages: RouterAdapter.getPageInfoForComponents(this.value.routes || []),
      orphanPages: RouterAdapter.getPageInfoForComponents(RouterAdapter.getPagesNotInAnyRouter())
    };
  }

  componentDidMount() {}

  componentWillUnmount() {}

  /**
   * Every edit goes through here, and every edit REPLACES the value instead of editing it.
   *
   * `this.value` is the very object stored on the node — `getParameter('pages')` hands back
   * the live reference. Mutating it and passing that same reference to `setParameter()`
   * leaves the model unable to see that anything changed, and leaves the undo entry holding
   * an "old value" that has already been modified. Deep copy, mutate the copy, hand that
   * over.
   */
  commit(mutate: (pages: TSFixme) => void) {
    // @ts-expect-error
    const next = JSON.parse(JSON.stringify(this.value || {}));
    if (next.routes === undefined) next.routes = [];

    mutate(next);

    // @ts-expect-error
    this.value = next;
    // @ts-expect-error
    this.props.onChange && this.props.onChange(next);

    this.setState({
      pages: RouterAdapter.getPageInfoForComponents(next.routes),
      orphanPages: RouterAdapter.getPageInfoForComponents(RouterAdapter.getPagesNotInAnyRouter())
    });
  }

  addPage(component: string) {
    this.commit((pages) => {
      if (pages.routes.indexOf(component) === -1) pages.routes.push(component);
      if (pages.startPage === undefined) pages.startPage = pages.routes[0];
    });
  }

  onPageClicked(p) {
    // @ts-expect-error
    this.props.onPageClicked && this.props.onPageClicked(p);
  }

  removePage(p) {
    this.commit((pages) => {
      const idx = pages.routes.indexOf(p.component);
      if (idx !== -1) pages.routes.splice(idx, 1);
      if (pages.startPage === p.component) pages.startPage = pages.routes[0];
    });
  }

  setAsStartPage(p) {
    this.commit((pages) => {
      pages.startPage = p.component;
    });
  }

  onAddNewPageClicked() {
    // Get page components
    // Filter out pages already in the router
    const pages = RouterAdapter.getPageComponents().filter(
      // @ts-expect-error
      (p) => this.value.routes == undefined || this.value.routes.indexOf(p) === -1
    );

    const props = {
      pages: RouterAdapter.getPageInfoForComponents(pages),
      onCreateNewPage: (name) => {
        if (name === undefined || name === '') {
          ToastLayer.showError('Component name cannot be empty');
          return;
        }

        // Place component in current folder
        const c = NodeGraphContextTmp.nodeGraph.getActiveComponent();
        const nameParts = c.fullName.split('/');
        nameParts.pop();

        const fullName = nameParts.join('/') + '/' + name;
        if (ProjectModel.instance.getComponentWithName(fullName)) {
          ToastLayer.showError('A component with that name already exists');
          return;
        }

        // Create the component
        const pageComponent = RouterAdapter.createPageComponent(fullName);

        ProjectModel.instance.addComponent(pageComponent, { undo: true, label: 'page created' });

        this.addPage(fullName);

        PopupLayer.instance.hidePopup();
      },
      onPageSelected: (page) => {
        this.addPage(page.component);

        PopupLayer.instance.hidePopup();
      }
    };
    const div = document.createElement('div');
    const root = createRoot(div);

    // PopupLayer.showPopup() measures the content with outerWidth/outerHeight the moment
    // it is handed over, and positions (and clamps to the window) from that measurement.
    // createRoot().render() is asynchronous, so without flushSync the div is still empty
    // when it gets measured: the popup ends up sized 0x0 and anchored past the right edge
    // of the window. That is why "Add new page" looked like it did nothing and the
    // existing pages could never be picked. showPopout() does not have this problem — it
    // re-measures through a ResizeObserver — but showPopup() only measures once.
    flushSync(() => {
      root.render(React.createElement(AddNewPagePopup, props));
    });

    PopupLayer.instance.showPopup({
      content: { el: $(div) },
      // @ts-expect-error
      attachTo: $(this.popupAnchor),
      position: 'right',
      // Deferred: onClose fires from inside this root's own event handlers
      // (onPageSelected/onCreateNewPage call hidePopup), and React refuses to unmount a
      // root while it is rendering.
      onClose: () => setTimeout(() => root.unmount(), 0)
    });
  }

  onPageActionsClicked(page, popupAnchor, evt) {
    const menu = new NewPopupLayer.PopupMenu({
      items: [
        {
          icon: IconName.Home,
          label: 'Make start page',
          onClick: () => {
            this.setAsStartPage(page);
          }
        },
        {
          icon: IconName.Trash,
          label: 'Remove page',
          onClick: () => {
            this.removePage(page);
          }
        }
      ]
    });
    menu.render();

    PopupLayer.instance.showPopup({
      content: menu,
      attachTo: $(popupAnchor),
      position: 'bottom',
      onOpen: function () {
        //   el.removeClass('sidebar-panel-item-show-on-hover');
      },
      onClose: function () {
        //   el.addClass('sidebar-panel-item-show-on-hover');
      }
    });

    evt.stopPropagation();
  }

  render() {
    return (
      // alignItems must stretch: the page rows size themselves with
      // `width: min(640px, calc(100% - 32px))`, and that 100% only resolves against a
      // full-width parent. Centering here made every row shrink-to-fit instead, which is
      // what turned the list into a column of narrow cards.
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
        {
          // @ts-expect-error
          this.state.pages !== undefined
            ? // @ts-expect-error
              this.state.pages.map((p) => (
                <BigPageItem
                  // @ts-expect-error
                  isStartPage={p.component === this.value.startPage}
                  page={p}
                  key={p.component || p.title}
                  onPageClicked={this.onPageClicked.bind(this, p)}
                  onPageActionsClicked={this.onPageActionsClicked.bind(this, p)}
                />
              ))
            : null
        }
        {/*
          Pages in the project that no router references, listed right here rather than
          only inside the "Add new page" popup.

          A page in no router is unreachable — it does not route, it is not in the top
          bar's page list, nothing renders it — and that is the normal outcome of deleting
          the router that owned it, since a Router carries its whole route list with it.
          Leaving the only way to re-attach such a page behind a popup made an orphaned
          page look like the editor had simply stopped seeing it.
        */}
        {
          // @ts-expect-error
          this.state.orphanPages.length > 0 && (
            <>
              <div className="router-pages-orphan-header">Not in any router</div>
              {
                // @ts-expect-error
                this.state.orphanPages.map((p) => (
                  <div style={{ display: 'flex', width: '100%' }} key={p.component}>
                    <div
                      className="router-pages-page router-pages-page-orphan"
                      onClick={() => this.addPage(p.component)}
                      title={'Add ' + (p.title || p.component) + ' to this router'}
                    >
                      <div style={{ display: 'flex' }}>
                        <div className="router-pages-icon"></div>
                      </div>
                      <div style={{ flexGrow: 1, minWidth: 0 }}>
                        <div className="router-pages-component">{p.title || p.component}</div>
                        <div className="router-pages-path">{p.path}</div>
                      </div>
                      <div className="router-pages-orphan-add">
                        <i className="fa fa-plus"></i>
                      </div>
                    </div>
                  </div>
                ))
              }
            </>
          )
        }

        <div
          className="sidebar-fullwidth-button"
          onClick={(e) => {
            e.stopPropagation();
            this.onAddNewPageClicked();
          }}
          ref={(el) => {
            // Block body on purpose: React 19 reads a value returned from a callback ref
            // as a cleanup function.
            // @ts-expect-error
            this.popupAnchor = el;
          }}
          style={{ width: 'min(640px, calc(100% - 32px))', alignSelf: 'center' }}
        >
          <i className="fa fa-plus" style={{ marginRight: '5px' }}></i>Add new page
        </div>
      </div>
    );
  }
}
