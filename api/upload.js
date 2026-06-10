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
    console.log("FILES =", files);

    return res.status(200).json({
      err: err?.message || null,
      fields,
      fileKeys: Object.keys(files || {}),
      hasFile: !!files.file,
    });
  });
};
