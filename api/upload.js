async function handler(req, res) {
  return res.status(200).json({
    test: "EHAB-123456"
  });
}

module.exports = handler;
