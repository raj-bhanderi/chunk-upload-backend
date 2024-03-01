const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const cors = require("cors");
const crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");

const app = express();
const port = 3001;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, `${file.originalname}.part${req?.body?.resumableChunkNumber}`);
  },
});

const upload = multer({ storage });

const readdir = promisify(fs.readdir);
const appendFile = promisify(fs.appendFile);
const unlink = promisify(fs.unlink);

app.use(express.json());
app.use(cors());
app.use("/uploads", express.static("uploads")); // Serve uploaded files statically
app.use("/merged_files", express.static("merged_files"));

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const chunkDir = path.join(__dirname, "uploads");
    const files = await fs.promises.readdir(chunkDir);
    if (files?.length === +req?.body?.resumableTotalChunks) {
      const response = await mergeChunk(req.body.resumableFilename);
      if (!!response) {
        const responseValue = await getVideoDetails(response?.relative_path);
        const extension = response?.relative_path?.split(".")?.at(-1);
        const newFileName = createUniqueFileName(req.body.resumableFilename);
        const thumbnailPath = `${newFileName?.replace(
          `.${extension}`,
          ".jpg"
        )}`;
        await extractThumbnailAndDuration(
          response?.relative_path,
          thumbnailPath,
          responseValue?.width,
          responseValue?.height
        ).then((data) => {
          console.log("🚀 ~ ).then ~ res:", data);
          res.status(200).json({
            message: "Chunks merged successfully",
            data: response,
            responseValue,
          });
        });
      }
    } else {
      res.status(200).send("Chunk uploaded successfully");
    }
  } catch (error) {
    console.log("🚀 ~ app.post ~ error:", error);
  }
});

const createUniqueFileName = (originalFileName) => {
  const fileExtension = originalFileName.split(".").pop();
  const date = new Date();
  const timestamp = date.getTime();
  const randomString = crypto.randomBytes(16).toString("hex");
  const uniqueFileName = `${timestamp}-${randomString}.${fileExtension}`;
  return uniqueFileName;
};

const mergeChunk = async (fileName) => {
  const filePath = path.join(__dirname, "uploads", fileName);
  const mergedFilePath = path.join(__dirname, "merged_files");
  const newFileName = createUniqueFileName(fileName);

  try {
    const parts = await readdir("uploads");
    const sortedFilenames = parts?.sort((a, b) => {
      const numA = parseInt(a.match(/(\d+)$/)[0]);
      const numB = parseInt(b.match(/(\d+)$/)[0]);
      return numA - numB;
    });

    for (let i = 0; i < sortedFilenames.length; i++) {
      const part = parts[i];
      console.log("🚀 ~ mergeChunk ~ part:", part);
      const partPath = path.join(__dirname, "uploads", part);
      await appendFile(filePath, await fs.promises.readFile(partPath));
      await unlink(partPath);
    }
    const response = await new Promise((resolve, reject) => {
      fs.rename(filePath, mergedFilePath + "/" + newFileName, (err) => {
        if (err) {
          console.error(`Error moving the file: ${err.message}`);
          reject(false);
        } else {
          console.log("File moved successfully!");
          resolve(true);
        }
      });
    });

    return response
      ? {
          path: `http://localhost:${port}/merged_files/` + newFileName,
          relative_path: mergedFilePath + "/" + newFileName,
        }
      : false;
  } catch (error) {
    console.log({ error });
  }
};

const getVideoDetails = async (inputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        console.log("🚀 ~ ByteVideosController ~ ffmpeg.ffprobe ~ err:", err);
        reject(err);
      } else {
        const width = metadata.streams[0].width || 0;
        const height = metadata.streams[0].height || 0;
        const duration = Math.round(
          metadata.format.duration ? metadata.format.duration : 0
        );
        resolve({ width, height, duration });
      }
    });
  });
};

const extractThumbnailAndDuration = async (
  inputPath,
  thumbnailPath,
  width,
  height
) => {
  try {
    await ffmpeg(inputPath)
      .screenshots({
        count: 1,
        folder: "./thumbnails",
        filename: thumbnailPath.split("/").pop() || "thumbnail.jpg",
        size: `${width}x${height}`,
      })
      .withVideoCodec("mjpeg");

    return true;
  } catch (error) {
    console.log("Error in extractThumbnailAndDuration:", error);
    return false;
  }
};

app.get("/", (req, res) => {
  res.send("Hello home");
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
