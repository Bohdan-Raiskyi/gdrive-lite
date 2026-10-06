const MIME_BY_EXTENSION = {
  cs: "text/plain; charset=utf-8",
  py: "text/plain; charset=utf-8",  // додано
  jpg: "image/jpeg",
  jpeg: "image/jpeg"
};

function getMimeType(extension) {
  return MIME_BY_EXTENSION[extension.toLowerCase()] || "application/octet-stream";
}

module.exports = { getMimeType };