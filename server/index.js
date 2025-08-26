const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/', express.static(path.join(__dirname, '../client')));

let currentPresentation = {
  currentSlide: null,
  slides: [],
  videoState: {
    playing: false,
    currentTime: 0
  }
};

// PDFのページ数を取得する関数（簡易版）
const getPDFPageCount = async (filePath) => {
  try {
    // pdf-parseライブラリを使用してページ数を取得
    const pdfParse = require('pdf-parse');
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    return data.numpages;
  } catch (error) {
    console.error('Error getting PDF page count:', error);
    return 10; // エラー時はデフォルト10ページ
  }
};

const getFileList = async () => {
  try {
    const uploadDir = path.join(__dirname, '../uploads');
    const categories = {
      'イントロ質疑': [],
      '倉林さん': [],
      '栗原先生': [],
      '高野さん': []
    };
    
    // 各カテゴリフォルダからファイルを取得
    for (const category of Object.keys(categories)) {
      const categoryDir = path.join(uploadDir, category);
      try {
        const files = await fs.readdir(categoryDir);
        console.log(`Category: ${category}, Files found:`, files); // デバッグログ追加
        
        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.mp4', '.html', '.md', '.pdf', '.pptx', '.ppt'].includes(ext)) {
            const filePath = path.join(categoryDir, file);
            const stats = await fs.stat(filePath);
            
            const fileInfo = {
              id: Date.now() + Math.random(),
              name: file,
              path: `/uploads/${encodeURIComponent(category)}/${encodeURIComponent(file)}`,
              type: getFileType(ext),
              size: stats.size,
              uploadedAt: stats.mtime,
              category: category
            };
            console.log(`Adding file to ${category}:`, file); // デバッグログ追加
            
            // PDFの場合はページ数を取得
            if (ext === '.pdf') {
              fileInfo.pageCount = await getPDFPageCount(filePath);
            } else if (ext === '.pptx' || ext === '.ppt') {
              fileInfo.pageCount = 10; // デフォルト値
            }
            
            categories[category].push(fileInfo);
          }
        }
      } catch (err) {
        console.log(`Category folder ${category} not found or empty`);
      }
    }
    
    return categories;
  } catch (error) {
    console.error('Error reading files:', error);
    return {
      'イントロ質疑': [],
      '倉林さん': [],
      '栗原先生': [],
      '高野さん': []
    };
  }
};

const getFileType = (ext) => {
  const typeMap = {
    '.png': 'image',
    '.jpg': 'image',
    '.jpeg': 'image',
    '.mp4': 'video',
    '.html': 'html',
    '.md': 'markdown',
    '.pdf': 'pdf',
    '.pptx': 'presentation',
    '.ppt': 'presentation'
  };
  return typeMap[ext] || 'unknown';
};

app.get('/api/files', async (req, res) => {
  const files = await getFileList();
  res.json(files);
});

app.get('/api/presentation', (req, res) => {
  res.json(currentPresentation);
});

// PDFファイル情報を取得（ページ番号付き）
app.get('/api/pdf/:filename/info', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../uploads', filename);
    
    // ファイルの存在確認
    await fs.access(filePath);
    
    // PDFのページ数を取得
    const pageCount = await getPDFPageCount(filePath);
    
    res.json({
      filename,
      path: `/uploads/${filename}`,
      pageCount
    });
  } catch (error) {
    console.error('Error getting PDF info:', error);
    res.status(500).json({ error: 'Error getting PDF info' });
  }
});

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  socket.emit('presentationUpdate', currentPresentation);
  
  socket.on('getFiles', async () => {
    const files = await getFileList();
    socket.emit('filesList', files);
  });
  
  socket.on('updateSlides', async (slides) => {
    currentPresentation.slides = slides;
    io.emit('presentationUpdate', currentPresentation);
  });
  
  socket.on('changeSlide', (slideData) => {
    currentPresentation.currentSlide = slideData;
    currentPresentation.videoState = {
      playing: false,
      currentTime: 0
    };
    io.emit('slideChanged', slideData);
  });
  
  socket.on('videoControl', (control) => {
    currentPresentation.videoState = control;
    io.emit('videoStateUpdate', control);
  });
  
  socket.on('playVideo', () => {
    currentPresentation.videoState.playing = true;
    io.emit('videoStateUpdate', currentPresentation.videoState);
  });
  
  socket.on('pauseVideo', () => {
    currentPresentation.videoState.playing = false;
    io.emit('videoStateUpdate', currentPresentation.videoState);
  });
  
  socket.on('seekVideo', (time) => {
    currentPresentation.videoState.currentTime = time;
    io.emit('videoStateUpdate', currentPresentation.videoState);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Local access: http://localhost:${PORT}`);
  console.log(`Network access: http://[YOUR_IP_ADDRESS]:${PORT}`);
  console.log(`Upload files to: ${path.join(__dirname, '../uploads')}`);
});