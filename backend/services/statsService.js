function calculateStat(values, operation) {
    switch (operation) {
      case 'count':
        return values.length;
      case 'mean':
        return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2));
      case 'median':
        values.sort((a, b) => a - b);
        const mid = Math.floor(values.length / 2);
        return Number((values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2).toFixed(2));
      case 'sum':
        return Number(values.reduce((a, b) => a + b, 0).toFixed(2));
      case 'min':
        return Number(Math.min(...values).toFixed(2));
      case 'max':
        return Number(Math.max(...values).toFixed(2));
      default:
        throw new Error(`Invalid operation: ${operation}`);
    }
  }
  
  function calculateCorrelation(x, y) {
    const n = x.length;
    if (n !== y.length || n === 0) {
      throw new Error('Arrays must have the same length and not be empty');
    }
  
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const meanX = sumX / n;
    const meanY = sumY / n;
  
    const covXY = x.reduce((acc, xi, i) => {
      return acc + (xi - meanX) * (y[i] - meanY);
    }, 0) / n;
  
    const varX = x.reduce((acc, xi) => {
      return acc + Math.pow(xi - meanX, 2);
    }, 0) / n;
  
    const varY = y.reduce((acc, yi) => {
      return acc + Math.pow(yi - meanY, 2);
    }, 0) / n;
  
    return covXY / Math.sqrt(varX * varY);
  }

  function computeStatistic({ operation, field, field2, groupBy, filters }, dataset) {
    if (!dataset || dataset.length === 0) {
      return { output: 'Dataset is empty or not loaded.', success: false };
    }
  
    const normalizeFieldName = (name) => name.toLowerCase().replace(/[\s_]/g, '');
    const availableFields = Object.keys(dataset[0]);
    
    // Find the main field for calculation
    const normalizedSearchField = normalizeFieldName(field);
    const actualField = availableFields.find(f => normalizeFieldName(f) === normalizedSearchField);
  
    if (!actualField) {
      return { 
        output: `Field "${field}" not found. Available fields are: ${availableFields.join(', ')}`,
        success: false 
      };
    }
  
    // Apply filters
    let filteredData = dataset;
    if (filters && Array.isArray(filters)) {
      filteredData = filteredData.filter((item) => {
        return filters.every((filter) => {
          const { field: filterField, operator, value } = filter;
          const normalizedFilterField = normalizeFieldName(filterField);
          const actualFilterField = availableFields.find(f => normalizeFieldName(f) === normalizedFilterField);
          
          if (!actualFilterField) return true;
  
          const itemValue = item[actualFilterField];
          const compareValue = typeof value === 'string' ? value.toLowerCase() : value;
          const compareItemValue = typeof itemValue === 'string' ? itemValue.toLowerCase() : itemValue;
          
          switch (operator) {
            case '==': return compareItemValue == compareValue;
            case '!=': return compareItemValue != compareValue;
            case '>': return parseFloat(itemValue) > parseFloat(value);
            case '<': return parseFloat(itemValue) < parseFloat(value);
            case '>=': return parseFloat(itemValue) >= parseFloat(value);
            case '<=': return parseFloat(itemValue) <= parseFloat(value);
            default: return true;
          }
        });
      });
    }
  
    // Handle correlation
    if (operation === 'correlation' && field2) {
      const normalizedSearchField2 = normalizeFieldName(field2);
      const actualField2 = availableFields.find(f => normalizeFieldName(f) === normalizedSearchField2);
      
      if (!actualField2) {
        return {
          output: `Second field "${field2}" not found for correlation calculation.`,
          success: false
        };
      }
  
      const values1 = [];
      const values2 = [];
  
      filteredData.forEach(item => {
        const val1 = parseFloat(item[actualField]);
        const val2 = parseFloat(item[actualField2]);
        if (!isNaN(val1) && !isNaN(val2)) {
          values1.push(val1);
          values2.push(val2);
        }
      });
  
      const correlation = calculateCorrelation(values1, values2);
      return {
        output: {
          correlation: Number(correlation.toFixed(3)),
          field1Stats: {
            mean: calculateStat(values1, 'mean'),
            min: calculateStat(values1, 'min'),
            max: calculateStat(values1, 'max')
          },
          field2Stats: {
            mean: calculateStat(values2, 'mean'),
            min: calculateStat(values2, 'min'),
            max: calculateStat(values2, 'max')
          }
        },
        success: true,
        operation: 'correlation',
        fields: [actualField, actualField2]
      };
    }
  
    // Handle grouped statistics
    if (groupBy) {
      const normalizedGroupField = normalizeFieldName(groupBy);
      const actualGroupByField = availableFields.find(f => normalizeFieldName(f) === normalizedGroupField);
      
      if (!actualGroupByField) {
        return {
          output: `GroupBy field "${groupBy}" not found`,
          success: false
        };
      }
  
      const groups = {};
      filteredData.forEach(item => {
        const groupValue = item[actualGroupByField];
        if (!groups[groupValue]) {
          groups[groupValue] = [];
        }
        
        if (operation === 'count') {
          groups[groupValue].push(item);
        } else {
          const val = item[actualField];
          const numericVal = typeof val === 'string' ? parseFloat(val.replace(/[$,]/g, '')) : parseFloat(val);
          if (!isNaN(numericVal)) {
            groups[groupValue].push(numericVal);
          }
        }
      });
  
      const results = {};
      for (const [groupValue, values] of Object.entries(groups)) {
        if (values.length === 0) continue;
        results[groupValue] = calculateStat(values, operation);
      }
  
      return {
        output: results,
        success: true,
        operation: operation,
        field: actualField,
        groupBy: actualGroupByField
      };
    }
  
    // Handle regular statistics
    const values = operation === 'count' ? 
      filteredData.map(item => item[actualField]) :
      filteredData
        .map(item => {
          const val = item[actualField];
          return typeof val === 'string' ? parseFloat(val.replace(/[$,]/g, '')) : parseFloat(val);
        })
        .filter(val => !isNaN(val));
  
    if (values.length === 0) {
      return {
        output: `No valid ${operation === 'count' ? '' : 'numerical '}data available for field "${actualField}"`,
        success: false
      };
    }
  
    const result = calculateStat(values, operation);
    
    return {
      output: result,
      success: true,
      operation: operation,
      field: actualField,
      processedCount: values.length,
      totalCount: filteredData.length
    };
  }

  // Helper Functions
function getDatasetInfo(data) {
    if (!data || data.length === 0) {
      console.error('getDatasetInfo: Data is empty or undefined');
      return null;
    }
  
    const columns = Object.keys(data[0]);
    const dataTypes = {};
    const sampleValues = {};
  
    columns.forEach((col) => {
      const values = data.map((row) => row[col]);
      dataTypes[col] = inferVegaLiteType(values);
      sampleValues[col] = values.slice(0, 3);
    });
  
    return { columns, dataTypes, sampleValues };
  }

  function inferVegaLiteType(values) {
    const sampleSize = 30;
    const spread = Math.floor(values.length / 3);
    const sampleValues = [
      ...values.slice(0, sampleSize),
      ...values.slice(spread, spread + sampleSize),
      ...values.slice(-sampleSize)
    ].filter(v => v !== null && v !== undefined);
  
    if (sampleValues.length === 0) return 'nominal';
  
    const numberValues = sampleValues.map(v => parseFloat(v));
    if (numberValues.every(v => !isNaN(v))) {
      return 'quantitative';
    }
  
    const dateValues = sampleValues.map(v => new Date(v));
    if (dateValues.every(v => !isNaN(v.getTime()))) {
      return 'temporal';
    }
  
    const uniqueValues = new Set(sampleValues);
    if (uniqueValues.size <= Math.min(10, sampleValues.length * 0.2)) {
      return 'ordinal';
    }
  
    return 'nominal';
  }

  module.exports = {
    calculateStat,
    calculateCorrelation,
    computeStatistic,
    getDatasetInfo,
    inferVegaLiteType
  };