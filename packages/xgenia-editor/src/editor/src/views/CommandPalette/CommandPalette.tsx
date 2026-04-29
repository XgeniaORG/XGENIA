import React, { useState, useEffect, useRef } from 'react';
import styles from './CommandPalette.module.scss';
import { ToolMetadata } from '../../models/ToolsModel';

interface ToolInfo {
  name: string;
  id: string;
  type?: 'tool' | 'action';
  category?: string;
  description?: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  tools: ToolInfo[];
  xgeniaTools: ToolMetadata[];
  onToolSelected?: (tool: ToolInfo) => void;
  onXgeniaToolSelected?: (tool: ToolMetadata) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = (props) => {
  const { 
    isOpen,
    onClose,
    tools,
    xgeniaTools,
    onToolSelected,
    onXgeniaToolSelected
  } = props;

  console.log('[CommandPalette] Received props:', props);

  const [searchTerm, setSearchTerm] = useState('');
  const [allItems, setAllItems] = useState<(ToolInfo | ToolMetadata)[]>([]);
  const [filteredItems, setFilteredItems] = useState<(ToolInfo | ToolMetadata)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const isXgeniaTool = (item: ToolInfo | ToolMetadata): item is ToolMetadata => {
    return 'componentName' in item;
  };

  // Effect for merging tools from props
  useEffect(() => {
    console.log(`[CommandPalette] useEffect merging tools. props.tools count: ${tools.length}, props.xgeniaTools count: ${xgeniaTools.length}`);
    const safePropsTools = Array.isArray(tools) ? tools : [];
    const safeXgeniaTools = Array.isArray(xgeniaTools) ? xgeniaTools : [];
    const combined = [...safePropsTools, ...safeXgeniaTools];
    setAllItems(combined);
    console.log(`[CommandPalette] useEffect: Combined allItems count: ${combined.length}`);
  }, [tools, xgeniaTools]); // Re-run if either props.tools or props.xgeniaTools change

  // Effect for filtering items based on searchTerm and allItems
  useEffect(() => {
    console.log('[CommandPalette] Filtering. SearchTerm:', searchTerm, 'AllItems count:', allItems.length);
    const filtered = allItems.filter(item => {
      const name = isXgeniaTool(item) ? item.name : item.name;
      const description = isXgeniaTool(item) ? item.description : item.description;
      const category = isXgeniaTool(item) ? item.category : item.category;
      
      const searchLower = searchTerm.toLowerCase();
      return name.toLowerCase().includes(searchLower) ||
             (description && description.toLowerCase().includes(searchLower)) ||
             (category && category.toLowerCase().includes(searchLower));
    });
    
    setFilteredItems(filtered);
    setActiveIndex(0);
    console.log('[CommandPalette] Filtered items count:', filtered.length);
  }, [searchTerm, allItems]);

  // Effect to focus input when palette opens
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setSearchTerm(''); 
    }
  }, [isOpen]);

  // Effect to scroll active item into view
  useEffect(() => {
    if (isOpen && listRef.current && listRef.current.children[activeIndex]) {
      listRef.current.children[activeIndex].scrollIntoView({
        block: 'nearest',
      });
    }
  }, [activeIndex, isOpen]); // Add isOpen dependency

  if (!isOpen) {
    console.log('[CommandPalette] isOpen is false, returning null.');
    return null;
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(prevIndex => (prevIndex + 1) % (filteredItems.length || 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(prevIndex => (prevIndex - 1 + filteredItems.length) % (filteredItems.length || 1));
    } else if (event.key === 'Enter') {
      if (filteredItems.length > 0 && filteredItems[activeIndex]) {
        handleSelectItem(filteredItems[activeIndex]);
      }
    }
  };

  const handleSelectItem = (item: ToolInfo | ToolMetadata) => {
    if (isXgeniaTool(item)) {
      console.log('[CommandPalette] Selected XGENIA tool:', item);
      onXgeniaToolSelected?.(item);
    } else {
      console.log('[CommandPalette] Selected generic action:', item);
      onToolSelected?.(item);
    }
    onClose();
  };

  const getItemDisplayName = (item: ToolInfo | ToolMetadata): string => {
    return isXgeniaTool(item) ? item.name : item.name;
  };

  const getItemDescription = (item: ToolInfo | ToolMetadata): string | undefined => {
    return isXgeniaTool(item) ? item.description : item.description;
  };

  const getItemCategory = (item: ToolInfo | ToolMetadata): string | undefined => {
    return isXgeniaTool(item) ? item.category : item.category;
  };

  console.log('[CommandPalette] isOpen is true, rendering with filtering logic. Filtered items:', filteredItems.length);
  return (
    <div 
      className={styles.overlay} 
      onClick={onClose}
    >
      <div 
        className={styles.palette} 
        onClick={e => e.stopPropagation()} 
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Search tools and actions..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className={styles.input}
        />
        <div style={{padding: '10px', color: 'white', textAlign: 'center'}}>
            SearchTerm: {searchTerm} | Filtered Items: {filteredItems.length}
        </div>
        {filteredItems.length > 0 ? (
          <ul ref={listRef} className={styles.list}>
            {filteredItems.map((item, index) => {
              const displayName = getItemDisplayName(item);
              const description = getItemDescription(item);
              const category = getItemCategory(item);
              const itemId = isXgeniaTool(item) ? item.id : item.id;
              
              return (
              <li
                  key={itemId}
                className={`${styles.listItem} ${index === activeIndex ? styles.active : ''}`}
                  onClick={() => handleSelectItem(item)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                  <div className={styles.itemContent}>
                    <div className={styles.itemName}>
                      {displayName}
                      {isXgeniaTool(item) && <span className={styles.toolBadge}>Tool</span>}
                    </div>
                    {(description || category) && (
                      <div className={styles.itemMeta}>
                        {category && <span className={styles.category}>{category}</span>}
                        {description && <span className={styles.description}>{description}</span>}
                      </div>
                    )}
                  </div>
              </li>
              );
            })}
          </ul>
        ) : (
          <div className={styles.noResults}>No tools or actions found.</div>
        )}
        <button 
          onClick={onClose} 
          style={{padding: '10px', fontSize: '16px', margin: '20px auto', display: 'block'}}
        >
          Close Palette
        </button>
      </div>
    </div>
  );
}; 