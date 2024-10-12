import React, { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { csvParse, autoType } from 'd3-dsv'; 

function FileUpload({ onFileUploaded }) {
    const onDrop = (acceptedFiles) => {
        const file = acceptedFiles[0];

        if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
            alert('Please upload a CSV file.');
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const csvText = reader.result;
            const data = csvParse(csvText, autoType);
            onFileUploaded(data);
        };
        reader.readAsText(file);
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

    return (
        <div
            {...getRootProps()}
            className={`w-full p-6 border-2 border-dashed rounded-md cursor-pointer focus:outline-none ${
                isDragActive ? 'border-blue-400' : 'border-gray-300'
            }`}
        >
            <input {...getInputProps()} />
            {isDragActive ? (
                <p className="text-center text-blue-400">Drop the CSV file here...</p>
            ) : (
                <p className="text-center text-gray-500">
                    Drag and drop a CSV file here, or click to select one
                </p>
            )}
        </div>
    );
}

function DataPreview({ data }) {
  const [isTableVisible, setIsTableVisible] = useState(false);

  const previewData = data.slice(0, 10);

  return (
    <div>
      <div className="flex justify-center">
        <button
          onClick={() => setIsTableVisible(!isTableVisible)}
          className="mt-4 mb-2 px-6 py-2 bg-gray-200 rounded-full text-[#281332]"
        >
          {isTableVisible ? 'Hide Table Preview' : 'Show Table Preview'}
        </button>
      </div>

      {isTableVisible && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 border">
            <thead className="bg-gray-50">
              <tr>
                {Object.keys(previewData[0]).map((key) => (
                  <th
                    key={key}
                    className="px-4 py-2 text-left text-xs font-medium text-[#281332] uppercase tracking-wider"
                  >
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {previewData.map((row, index) => (
                <tr key={index}>
                  {Object.values(row).map((value, idx) => (
                    <td
                      key={idx}
                      className="px-4 py-2 whitespace-nowrap text-sm text-[#281332]"
                    >
                      {value !== null ? value.toString() : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { FileUpload, DataPreview };