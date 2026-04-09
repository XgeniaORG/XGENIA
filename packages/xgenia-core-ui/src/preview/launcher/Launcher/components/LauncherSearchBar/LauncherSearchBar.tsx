import React, { useState } from 'react';

import { Icon, IconName } from '@xgenia-core-ui/components/common/Icon';
import { Select, SelectColorTheme, SelectOption } from '@xgenia-core-ui/components/inputs/Select';
import { TextInput, TextInputVariant } from '@xgenia-core-ui/components/inputs/TextInput';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { HStack } from '@xgenia-core-ui/components/layout/Stack';
import { TextType } from '@xgenia-core-ui/components/typography/Text';

interface UseLauncherSearchBarProps {
  filterDropdownItems: SelectOption[];
  propertyNameToFilter: TSFixme;
  allItems: TSFixme;
}

interface LauncherSearchBarProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  filterDropdownItems: UseLauncherSearchBarProps['filterDropdownItems'];
  filterValue: SelectOption['value'];
  setFilterValue: (value: SelectOption['value']) => void;
}

export function useLauncherSearchBar({
  filterDropdownItems,
  allItems,
  propertyNameToFilter
}: UseLauncherSearchBarProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterValue, setFilterValue] = useState(filterDropdownItems[0].value);

  function createFilterFunction(propertyName, value) {
    return (item) => {
      let propertyChain = propertyName.split('.');
      let currentValue = item;

      for (let prop of propertyChain) {
        if (currentValue.hasOwnProperty(prop)) {
          currentValue = currentValue[prop];
        } else {
          return false; // Property not found, filter it out
        }
      }

      return currentValue === value;
    };
  }

  const filteredItems =
    filterValue !== 'all' ? allItems.filter(createFilterFunction(propertyNameToFilter, filterValue)) : allItems;

  const searchedItems = Boolean(searchTerm)
    ? filteredItems.filter((project) => project.title.toLowerCase().includes(searchTerm.toLowerCase()))
    : filteredItems;

  return {
    items: searchedItems,
    filterValue,
    setFilterValue,
    searchTerm,
    setSearchTerm
  };
}

export function LauncherSearchBar({
  searchTerm,
  setSearchTerm,
  filterDropdownItems,
  setFilterValue,
  filterValue
}: LauncherSearchBarProps) {
  return (
    <Box hasBottomSpacing>
      <HStack hasSpacing UNSAFE_style={{ paddingBottom: 4, borderBottom: '1px solid var(--theme-color-bg-3)' }}>
        <TextInput
          slotBeforeInput={<Icon icon={IconName.Search} variant={TextType.Shy} />}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.currentTarget.value)}
          variant={TextInputVariant.Transparent}
        />

        <div style={{ width: 220 }}>
          <Select
            options={filterDropdownItems}
            onChange={setFilterValue}
            value={filterValue}
            colorTheme={SelectColorTheme.Transparent}
          />
        </div>
      </HStack>
    </Box>
  );
}
