const { IncomingForm } = require("formidable");

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = async (req, res) => {
  const form = new IncomingForm({
    multiples: false,
    keepExtensions: true,
  });

  form.parse(req, (err, fields, files) => {
    res.status(200).json({
      err: err?.message || null,
      fields,
      files,
      fileKeys: Object.keys(files || {})
    });
  });
};
