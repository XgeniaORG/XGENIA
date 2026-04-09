import React from 'react';

export interface IRadioButtonContext {
  name: string;
  selected: string;
  checkedChanged?: (value: string) => void;
}

const RadioButtonContext = React.createContext<IRadioButtonContext>({
  name: '',
  selected: '',
  checkedChanged: undefined
});

export default RadioButtonContext;
