const http = require('http');

// Simulate the multipart parsing logic
function parseMultipart(buffer, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const closingBoundaryBuffer = Buffer.from(`--${boundary}--`);

  const fields = {};
  const files = {};

  let start = buffer.indexOf(boundaryBuffer);
  console.log('First boundary at:', start);

  let iteration = 0;
  while (start !== -1 && iteration < 20) {
    iteration++;
    start += boundaryBuffer.length;

    // Check if this is the closing boundary (--boundary--)
    if (buffer.slice(start, start + 2).toString() === '--') {
      console.log('Found closing boundary, stopping');
      break;
    }

    // Skip \r\n after boundary
    if (buffer.slice(start, start + 2).toString() === '\r\n') start += 2;

    // Find next boundary (regular or closing)
    let end = buffer.indexOf(boundaryBuffer, start);
    if (end === -1) {
      end = buffer.indexOf(closingBoundaryBuffer, start);
      if (end === -1) {
        console.log('No next boundary found');
        break;
      }
    }

    const part = buffer.slice(start, end);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      console.log('No header end in part');
      start = end;
      continue;
    }

    const header = part.slice(0, headerEnd).toString();
    let body = part.slice(headerEnd + 4);

    // Remove trailing \r\n from body (before next boundary)
    if (body.length >= 2 && body.slice(body.length - 2).toString() === '\r\n') {
      body = body.slice(0, body.length - 2);
    }

    const nameMatch = header.match(/name="([^"]+)"/);
    const filenameMatch = header.match(/filename="([^"]+)"/);

    console.log('Part header:', header.substring(0, 100));
    console.log('  nameMatch:', nameMatch ? nameMatch[1] : null);
    console.log('  filenameMatch:', filenameMatch ? filenameMatch[1] : null);
    console.log('  body length:', body.length);

    if (filenameMatch && nameMatch) {
      files[nameMatch[1]] = { filename: filenameMatch[1], size: body.length };
    } else if (nameMatch) {
      fields[nameMatch[1]] = body.toString();
    }

    start = end;
  }

  return { fields, files };
}

// Test with actual browser-like multipart data
const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
const data = `------WebKitFormBoundary7MA4YWxkTrZu0gW\r\n` +
  `Content-Disposition: form-data; name="name"\r\n\r\n` +
  `TestTemplate\r\n` +
  `------WebKitFormBoundary7MA4YWxkTrZu0gW\r\n` +
  `Content-Disposition: form-data; name="description"\r\n\r\n` +
  `desc\r\n` +
  `------WebKitFormBoundary7MA4YWxkTrZu0gW\r\n` +
  `Content-Disposition: form-data; name="fileType"\r\n\r\n` +
  `docx\r\n` +
  `------WebKitFormBoundary7MA4YWxkTrZu0gW\r\n` +
  `Content-Disposition: form-data; name="templateFile"; filename="test.docx"\r\n` +
  `Content-Type: application/octet-stream\r\n\r\n` +
  `test content\r\n` +
  `------WebKitFormBoundary7MA4YWxkTrZu0gW--\r\n`;

const buffer = Buffer.from(data);
console.log('Total buffer length:', buffer.length);
console.log('');

const result = parseMultipart(buffer, boundary);
console.log('\nResult:');
console.log('Fields:', result.fields);
console.log('Files:', result.files);
