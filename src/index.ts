import express from 'express';
import axios from 'axios';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs-extra';
import config from '../config.json';

const router = express.Router()
const app = express();

// Middleware
app.use(cors());
app.use(morgan('combined'));
// Ensure cache directory exists
fs.ensureDirSync(config.cacheDir);

async function tryRepositories(group: string, artifact: string, version: string, filename: string) {
    const artifactPath = `${group.replace(/\./g, '/')}/${artifact}/${version}/${filename}`;

    // Check cache first
    const cachePath = path.join(config.cacheDir, artifactPath);
    if (await fs.pathExists(cachePath)) {
        return fs.createReadStream(cachePath);
    }

    // Try each repository in order
    for (const repoUrl of config.repositories) {
        try {
            const url = `${repoUrl}/${artifactPath}`;
            const response = await axios.get(url, {responseType: 'stream'});

            // Cache the file
            await fs.ensureDir(path.dirname(cachePath));
            const writer = fs.createWriteStream(cachePath);
            response.data.pipe(writer);

            return response.data;
        } catch (error: any) {
            // Continue to next repository if artifact not found
            if (error.response?.status !== 404) {
                console.error(`Error accessing ${repoUrl}: ${error.message}`);
            }
        }
    }

    return null;
}

const contextPath = config.contextPath || "/"
router.route('/*').get(async (req, res): Promise<any> => {
    const pathParts = req.path.split('/').filter(p => p);

    if (pathParts.length < 4) {
        return res.status(400).send('Invalid Maven artifact path');
    }

    const filename = pathParts.pop()!;
    const version = pathParts.pop()!;
    const artifact = pathParts.pop()!;
    const group = pathParts.join('.');

    try {
        const dataStream = await tryRepositories(group, artifact, version, filename);

        if (!dataStream) {
            return res.status(404).send('Artifact not found in any repository');
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        dataStream.pipe(res);
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});
app.use(contextPath, router)
app.listen(config.port, () => {
    console.log(`Maven proxy running on http://localhost:${config.port}/${contextPath}`);
});