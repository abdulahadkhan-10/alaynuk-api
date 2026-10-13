import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { errorMiddleware } from './middleware/error.middleware';
import routes from './routes';
import { swaggerDocument } from './config/swagger';

const app = express();

// Security Middlewares
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server, mobile or tools without origin
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      "https://alaynai.com",
      "https://www.alaynai.com",
      "https://admin.alaynai.com",
    ];

    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

    if (isLocalhost || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'x-outlet-id',
    'X-Outlet-Id',
    'x-refresh-token',
    'X-Refresh-Token',
    'x-business-id',
    'X-Business-Id',
    'x-active-branch-id',
    'X-Active-Branch-Id',
    'x-portal',
    'X-Portal',
    'Cache-Control',
    'Pragma',
  ],
  exposedHeaders: ['Set-Cookie'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));


// Request Parsers
app.use(cookieParser());
app.use(
  express.json({
    limit: '50mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  })
);
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve Static Uploads
import path from 'path';
app.use(
  '/uploads',
  cors(),
  express.static(path.resolve(__dirname, '../uploads'), {
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  })
);

// Swagger UI Documentation
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Route Mappings
app.use('/api/v1', routes);

// Base Route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Alayn Operations & Management Platform API',
    docs: '/api/docs',
  });
});

// Error handling middleware (MUST be last)
app.use(errorMiddleware);

export { app };
export default app;
