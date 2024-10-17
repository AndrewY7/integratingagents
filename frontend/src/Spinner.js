import React from 'react';

const Spinner = () => (
  <svg
    width="80"
    height="20"
    viewBox="0 0 80 20"
    xmlns="http://www.w3.org/2000/svg"
    fill="#fff"
  >
    <rect width="80" height="20" fill="none" />
    <rect x="0" y="0" width="20" height="20">
      <animate
        attributeName="x"
        from="-20"
        to="80"
        dur="1s"
        repeatCount="indefinite"
      />
    </rect>
  </svg>
);

export default Spinner;