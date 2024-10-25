// Utility Functions
function print_red(...strings) {
    console.log('\x1b[31m%s\x1b[0m', strings.join(' '));
  }
  
  function print_blue(...strings) {
    console.log('\x1b[34m%s\x1b[0m', strings.join(' '));
  }

  // Utility object for validation and debugging
const serverUtils = {
    validateVegaSpec: (spec) => {
      const requiredProps = ['mark', 'encoding'];
      const issues = [];
      
      if (!spec) {
        return { isValid: false, issues: ['Specification is null or undefined'] };
      }
      
      requiredProps.forEach(prop => {
        if (!spec[prop]) {
          issues.push(`Missing required property: ${prop}`);
        }
      });
      
      if (spec.encoding) {
        const hasValidChannel = Object.keys(spec.encoding).some(channel => 
          ['x', 'y', 'color', 'size', 'shape'].includes(channel)
        );
        if (!hasValidChannel) {
          issues.push('No valid encoding channels found');
        }
      }
      
      return {
        isValid: issues.length === 0,
        issues
      };
    },
  
    debugDataset: (data) => {
      if (!data || !Array.isArray(data)) {
        return {
          isValid: false,
          issues: ['Dataset is not an array or is null']
        };
      }
  
      const sample = data.slice(0, 5);
      const columnTypes = {};
      const issues = [];
  
      if (sample.length > 0) {
        const columns = Object.keys(sample[0]);
        
        columns.forEach(col => {
          const values = sample.map(row => row[col]);
          const types = new Set(values.map(val => typeof val));
          columnTypes[col] = Array.from(types);
          
          if (types.size > 1) {
            issues.push(`Mixed types in column "${col}": ${Array.from(types).join(', ')}`);
          }
        });
      }
  
      return {
        isValid: issues.length === 0,
        issues,
        debugInfo: {
          totalRows: data.length,
          sampleData: sample,
          columnTypes
        }
      };
    }
  };

  module.exports = {
    print_red,
    print_blue,
    serverUtils
  };