# Math Node Integration for Supabase Converter

This document describes the clean, maintainable, and scalable architecture for integrating math nodes with the Supabase Edge Function converter.

## Architecture Overview

The math node integration follows a modular, extensible design with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                    CloudFunctionConverter                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │ JavaScript      │  │ Math Node       │  │ Other Node  │ │
│  │ Function        │  │ Converter       │  │ Converters  │ │
│  │ Handler         │  │                 │  │ (Future)    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ MathNodeConverter│
                    │  ┌─────────────┐ │
                    │  │ Registry    │ │
                    │  └─────────────┘ │
                    │  ┌─────────────┐ │
                    │  │ Calculation │ │
                    │  │ Generator   │ │
                    │  └─────────────┘ │
                    └─────────────────┘
```

## Key Components

### 1. MathNodeRegistry
- **Purpose**: Central registry of all supported math node types
- **Location**: `math-node-converter.ts`
- **Features**:
  - Type-safe configuration for each math node
  - Input/output port definitions
  - Default values for parameters
  - Easy addition of new math node types

### 2. MathCalculationGenerator
- **Purpose**: Generates calculation logic for each math node type
- **Location**: `math-node-converter.ts`
- **Features**:
  - Pure functions for each calculation type
  - Error handling and validation
  - Edge Function compatible code generation
  - Support for complex algorithms (ISAAC RNG, etc.)

### 3. MathNodeConverter
- **Purpose**: Main interface for converting math nodes to Supabase Edge Function code
- **Location**: `math-node-converter.ts`
- **Features**:
  - Clean API for math node conversion
  - Parameter mapping and sanitization
  - Integration with main converter

### 4. CloudFunctionConverter Integration
- **Purpose**: Seamless integration with existing converter
- **Location**: `supabase-converter.ts`
- **Features**:
  - Automatic detection of math nodes
  - Unified function name generation
  - Response mapping for math node outputs

## Supported Math Nodes

### Basic Arithmetic
- **Addition**: `firstNumber + secondNumber`
- **Subtraction**: `firstNumber - secondNumber`
- **Multiplication**: `firstNumber * secondNumber`
- **Division**: `firstNumber / secondNumber` (with zero-division protection)
- **Modulo**: `firstNumber % secondNumber` (with zero-division protection)

### Comparison Operations
- **Min**: `Math.min(firstValue, secondValue)`
- **Max**: `Math.max(firstValue, secondValue)`
- **Less Than Or Equal**: `firstNumber <= secondNumber`
- **Equal**: `firstValue === secondValue`

### Array Operations
- **Min Array**: Find minimum value in array (with key path support)
- **Max Array**: Find maximum value in array (with key path support)
- **Sum**: Sum array values or concatenate strings

### Rounding Operations
- **Round**: `Math.round(value)`
- **Floor**: `Math.floor(value)`
- **Ceil**: `Math.ceil(value)`

### Random Number Generators
- **True Random Number Generator**: Uses `crypto.getRandomValues()` when available
- **True Random Number Array Generator**: Generates arrays of random numbers
- **ISAAC Random Number Generator**: Cryptographically secure pseudorandom generator
- **ISAAC Random Number Array Generator**: Arrays using ISAAC algorithm

### Formula Operations
- **Single Parameter Formula**: Evaluate mathematical expressions with one variable
- **Formula-Generated Array**: Generate arrays using mathematical formulas

## Usage Examples

### Basic Usage

```typescript
import { CloudFunctionConverter } from './supabase-converter';

// Create a component with math nodes
const component: Component = {
  name: '/#__cloud__/math-calculator',
  id: 'calc-1',
  graph: {
    roots: [
      // Request node
      {
        id: 'request-1',
        typename: 'xgenia.cloud.request',
        // ... request configuration
      },
      // Addition node
      {
        id: 'addition-1',
        typename: 'Addition',
        // ... addition configuration
      },
      // Response node
      {
        id: 'response-1',
        typename: 'xgenia.cloud.response',
        // ... response configuration
      }
    ],
    connections: [
      // ... connections between nodes
    ]
  }
};

// Generate Supabase Edge Function
const converter = new CloudFunctionConverter(component);
const { name, code } = converter.generateSupabaseFunction();
```

### Generated Function Example

For an Addition node, the generated function would look like:

```typescript
const math_addition_12345 = (inputs: Record<string, any>) => {
  // Input parameter mapping
  const firstNumber = inputs.first_number !== undefined ? inputs.first_number : 0;
  const secondNumber = inputs.second_number !== undefined ? inputs.second_number : 0;
  
  // Core calculation logic
  const result = firstNumber + secondNumber;
  
  // Return results
  return { result: result };
};
```

## Adding New Math Nodes

### Step 1: Add to Registry

```typescript
// In MathNodeRegistry.MATH_NODES
['New Math Node', {
  nodeType: 'New Math Node',
  inputPorts: ['input1', 'input2'],
  outputPorts: ['result'],
  defaultValues: { input1: 0, input2: 0 },
  calculationMethod: 'calculate'
}]
```

### Step 2: Add Calculation Logic

```typescript
// In MathCalculationGenerator
private static generateNewMathNodeLogic(): string {
  return `
    const result = input1 + input2; // Your calculation logic
  `;
}

// Add to generateCalculationLogic method
'New Math Node': () => this.generateNewMathNodeLogic(),
```

### Step 3: Test

```typescript
// Test the new node type
const converter = new MathNodeConverter();
const isSupported = converter.isMathNode('New Math Node');
console.log('New node supported:', isSupported);
```

## Parameter Flow

The parameter flow through the system is clearly defined:

1. **Input Parameters** (from request) → `inputs: Record<string, any>`
2. **Function Inputs** → `const firstNumber = inputs.first_number !== undefined ? inputs.first_number : 0;`
3. **Internal Variables** → `const result = firstNumber + secondNumber;`
4. **Output Parameters** → `return { result: result };`

## Error Handling

The system includes comprehensive error handling:

- **Division by zero**: Protected in Division and Modulo operations
- **Invalid arrays**: Validated in array operations
- **Formula errors**: Caught and re-thrown with context
- **Missing parameters**: Default values provided
- **Type validation**: Ensures correct data types

## Performance Considerations

- **Efficient code generation**: Minimal overhead in generated functions
- **Edge Function compatible**: All code runs efficiently in Supabase Edge Functions
- **Memory efficient**: No unnecessary object creation
- **Fast execution**: Direct mathematical operations without abstraction layers

## Testing

The implementation includes comprehensive tests:

- **Unit tests**: Individual math node conversion
- **Integration tests**: Full component conversion
- **Example components**: Real-world usage scenarios
- **Error case testing**: Invalid inputs and edge cases

## Future Extensions

The architecture is designed for easy extension:

1. **Data Node Converter**: For data manipulation nodes
2. **Logic Node Converter**: For conditional and logic nodes
3. **String Node Converter**: For string manipulation nodes
4. **Custom Node Converter**: For user-defined node types

## Benefits

1. **Maintainable**: Clear separation of concerns
2. **Scalable**: Easy to add new node types
3. **Type-safe**: Full TypeScript support
4. **Testable**: Modular design enables comprehensive testing
5. **Performant**: Optimized for Edge Function execution
6. **Extensible**: Ready for future node type additions

## Conclusion

This implementation provides a robust, scalable foundation for math node integration with the Supabase converter. The modular architecture ensures that adding new math nodes is straightforward while maintaining code quality and performance.
