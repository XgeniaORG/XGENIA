import { MCPTool } from '@xgenia-hooks/useMCPServerBrowser';
import classNames from 'classnames';
import React, { useState, useEffect } from 'react';

interface MCPToolSidebarProps {
  tool: MCPTool;
  serverName: string;
  onCreateNode: (parameters: any) => void;
  isParameterUpdate?: boolean;
  initialParameters?: Record<string, any>;
}

export function MCPToolSidebar({
  tool,
  serverName,
  onCreateNode,
  isParameterUpdate = false,
  initialParameters = {}
}: MCPToolSidebarProps) {
  const [parameters, setParameters] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Parse input schema to get properties and required fields
  const { properties, required = [] } = tool.inputSchema || {};
  const propertyEntries = properties ? Object.entries(properties) : [];

  // Initialize parameters with existing values or default values
  useEffect(() => {
    const initialParams: Record<string, any> = {};
    propertyEntries.forEach(([key, prop]: [string, any]) => {
      // Use existing parameter if available, otherwise use default
      if (initialParameters[key] !== undefined) {
        initialParams[key] = initialParameters[key];
      } else if (prop.default !== undefined) {
        initialParams[key] = prop.default;
      } else if (prop.type === 'string') {
        initialParams[key] = '';
      } else if (prop.type === 'number' || prop.type === 'integer') {
        initialParams[key] = 0;
      } else if (prop.type === 'boolean') {
        initialParams[key] = false;
      } else if (prop.type === 'array') {
        initialParams[key] = [];
      } else if (prop.type === 'object') {
        initialParams[key] = {};
      }
    });
    setParameters(initialParams);
  }, [tool, initialParameters]);

  // Truncate description to 100 characters
  const truncateDescription = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  // Validate parameter value based on its type
  const validateParameterValue = (key: string, value: any, prop: any): string | null => {
    // Required field validation
    if (required.includes(key)) {
      if (value === undefined || value === null || value === '') {
        return 'This field is required';
      }
    }

    // Type-specific validation
    switch (prop.type) {
      case 'number':
      case 'integer':
        if (value !== '' && value !== null && value !== undefined) {
          const num = Number(value);
          if (isNaN(num)) {
            return 'Must be a valid number';
          }
          if (prop.minimum !== undefined && num < prop.minimum) {
            return `Must be at least ${prop.minimum}`;
          }
          if (prop.maximum !== undefined && num > prop.maximum) {
            return `Must be at most ${prop.maximum}`;
          }
        }
        break;
      case 'string':
        if (prop.minLength !== undefined && value && value.length < prop.minLength) {
          return `Must be at least ${prop.minLength} characters`;
        }
        if (prop.maxLength !== undefined && value && value.length > prop.maxLength) {
          return `Must be at most ${prop.maxLength} characters`;
        }
        break;
      case 'array':
        if (!Array.isArray(value)) {
          return 'Must be a valid array';
        }
        break;
      case 'object':
        if (typeof value !== 'object' || value === null) {
          return 'Must be a valid object';
        }
        break;
    }

    return null;
  };

  // Validate all parameters
  const validateParameters = () => {
    const newErrors: Record<string, string> = {};

    propertyEntries.forEach(([key, prop]: [string, any]) => {
      const value = parameters[key];
      const error = validateParameterValue(key, value, prop);
      if (error) {
        newErrors[key] = error;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle parameter change with type conversion
  const handleParameterChange = (key: string, value: any, prop: any) => {
    let convertedValue = value;

    // Convert value based on property type
    switch (prop.type) {
      case 'number':
      case 'integer':
        if (value === '' || value === null || value === undefined) {
          convertedValue = 0;
        } else {
          const num = Number(value);
          convertedValue = isNaN(num) ? 0 : num;
        }
        break;
      case 'boolean':
        convertedValue = Boolean(value);
        break;
      case 'array':
        if (typeof value === 'string') {
          convertedValue = value.split('\n').filter((item: string) => item.trim());
        } else {
          convertedValue = Array.isArray(value) ? value : [];
        }
        break;
      case 'object':
        if (typeof value === 'string') {
          try {
            convertedValue = JSON.parse(value);
          } catch {
            convertedValue = value; // Keep as string while typing
          }
        }
        break;
      default:
        convertedValue = value;
    }

    setParameters((prev) => ({
      ...prev,
      [key]: convertedValue
    }));

    // Clear error when user starts typing
    if (errors[key]) {
      setErrors((prev) => ({
        ...prev,
        [key]: ''
      }));
    }
  };

  // Handle auto-persistence on blur, enter, or tab
  const handleAutoPersist = (key: string, value: any, prop: any) => {
    handleParameterChange(key, value, prop);
    // Auto-persist the parameter
    onCreateNode({ ...parameters, [key]: value });
  };

  // Handle form submission (now just validates and persists)
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateParameters()) {
      onCreateNode(parameters);
    }
  };

  // Render input field based on property type
  const renderInputField = (key: string, prop: any) => {
    const isRequired = required.includes(key);
    const hasError = errors[key];
    const value = parameters[key];
    const baseClasses = classNames(
      'w-full px-3 py-2 rounded border transition-colors',
      'bg-gray-800 text-white placeholder-gray-400',
      'focus:outline-none focus:ring-2 focus:ring-blue-500',
      {
        'border-red-500': hasError,
        'border-gray-600': !hasError,
        'focus:border-blue-500': !hasError
      }
    );

    switch (prop.type) {
      case 'string':
        return (
          <input
            type="text"
            value={value || ''}
            onChange={(e) => handleParameterChange(key, e.target.value, prop)}
            onBlur={() => handleAutoPersist(key, value || '', prop)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleAutoPersist(key, value || '', prop);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                handleAutoPersist(key, value || '', prop);
              }
            }}
            placeholder={prop.description || `Enter ${key}`}
            className={baseClasses}
            minLength={prop.minLength}
            maxLength={prop.maxLength}
          />
        );
      case 'number':
      case 'integer':
        return (
          <input
            type="number"
            value={value || ''}
            onChange={(e) => handleParameterChange(key, e.target.value, prop)}
            onBlur={() => handleAutoPersist(key, value || 0, prop)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleAutoPersist(key, value || 0, prop);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                handleAutoPersist(key, value || 0, prop);
              }
            }}
            placeholder={prop.description || `Enter ${key}`}
            className={baseClasses}
            min={prop.minimum}
            max={prop.maximum}
            step={prop.type === 'integer' ? '1' : 'any'}
          />
        );
      case 'boolean':
        return (
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={value || false}
              onChange={(e) => handleParameterChange(key, e.target.checked, prop)}
              onBlur={() => handleAutoPersist(key, value || false, prop)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleAutoPersist(key, value || false, prop);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  handleAutoPersist(key, value || false, prop);
                }
              }}
              className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500"
            />
            <span className="ml-2 text-sm text-gray-300">{prop.description || key}</span>
          </div>
        );
      case 'array':
        return (
          <textarea
            value={Array.isArray(value) ? value.join('\n') : ''}
            onChange={(e) =>
              handleParameterChange(
                key,
                e.target.value.split('\n').filter((item) => item.trim()),
                prop
              )
            }
            onBlur={() => handleAutoPersist(key, value || [], prop)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleAutoPersist(key, value || [], prop);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                handleAutoPersist(key, value || [], prop);
              }
            }}
            placeholder={prop.description || `Enter ${key} (one per line)`}
            className={baseClasses}
            rows={3}
          />
        );
      case 'object':
        return (
          <textarea
            value={typeof value === 'object' ? JSON.stringify(value, null, 2) : ''}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                handleParameterChange(key, parsed, prop);
              } catch {
                // Allow invalid JSON while typing
                handleParameterChange(key, e.target.value, prop);
              }
            }}
            onBlur={() => handleAutoPersist(key, value || {}, prop)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleAutoPersist(key, value || {}, prop);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                handleAutoPersist(key, value || {}, prop);
              }
            }}
            placeholder={prop.description || `Enter ${key} as JSON`}
            className={baseClasses}
            rows={4}
          />
        );
      default:
        return (
          <input
            type="text"
            value={value || ''}
            onChange={(e) => handleParameterChange(key, e.target.value, prop)}
            onBlur={() => handleAutoPersist(key, value || '', prop)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleAutoPersist(key, value || '', prop);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                handleAutoPersist(key, value || '', prop);
              }
            }}
            placeholder={prop.description || `Enter ${key}`}
            className={baseClasses}
          />
        );
    }
  };

  return (
    <div className="w-full h-full p-4 overflow-y-auto">
      <form onSubmit={handleSubmit} className="space-y-4">
        {propertyEntries.length === 0 ? (
          <div className="text-gray-400 text-center py-8">No parameters required for this tool.</div>
        ) : (
          <div className="space-y-4">
            {propertyEntries.map(([key, prop]: [string, any]) => {
              const isRequired = required.includes(key);
              return (
                <div key={key} className="space-y-2">
                  <label className="block">
                    <span className="text-sm font-medium text-white">
                      {key}
                      {isRequired && <span className="text-red-500 ml-1">*</span>}
                    </span>
                    {prop.description && (
                      <p className="text-xs text-gray-400 mt-1">{truncateDescription(prop.description)}</p>
                    )}
                    {/* Show type information for debugging */}
                    <p className="text-xs text-gray-500 mt-1">Type: {prop.type}</p>
                  </label>
                  {renderInputField(key, prop)}
                  {errors[key] && <p className="text-red-400 text-xs">{errors[key]}</p>}
                </div>
              );
            })}
          </div>
        )}
      </form>
    </div>
  );
}
