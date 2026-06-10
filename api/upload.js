async function handler(req, res) {
  return res.status(200).json({
    method: req.method,
    contentType: req.headers["content-type"],
    length: req.headers["content-length"]
  });
}

module.exports = handler;
