const formidable = require("formidable");

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

async function handler(req, res) {
  const form = new formidable.IncomingForm({
    multiples: false,
  });

  form.parse(req, (err, fields, files) => {
    return res.status(200).json({
      err: err ? err.message : null,
      fields,
      files,
      fileKeys: Object.keys(files || {}),
    });
  });
}

module.exports = handler;
