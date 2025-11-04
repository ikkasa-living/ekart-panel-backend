import { parse } from "csv-parse";
import fs from "fs";

export const parseCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    let rowCount = 0;

    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true }))
      .on("data", (row) => {
        rowCount++;
        results.push(row);
      })
      .on("end", () => {
        if (rowCount === 0) {
          return reject(new Error("CSV file is empty or has no data rows."));
        }
        resolve(results);
      })
      .on("error", (err) => reject(err));
  });
};
