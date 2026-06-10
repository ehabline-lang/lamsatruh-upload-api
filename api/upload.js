const formidable = require("formidable");

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = async (req, res) => {
  const form = formidable({ multiples: false });

  form.parse(req, (err, fields, files) => {
    return res.status(200).json({
      err: err?.message || null,
      fields,
      files,
      fileKeys: Object.keys(files || {})
    });
  });
};
