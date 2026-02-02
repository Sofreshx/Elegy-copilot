/**
 * Learning mode service for checkpoints, progress tracking, and spaced repetition.
 */

export interface Checkpoint {
  id: string;
  threadId: string;
  content: string;
  summary: string;
  tags: string[];
  createdAt: number;
  lastReviewed: number | null;
  nextReview: number | null;
  reviewCount: number;
  confidence: number; // 0-5 scale for spaced repetition
}

export interface LearningProgress {
  totalCheckpoints: number;
  reviewed: number;
  dueForReview: number;
  mastered: number; // confidence >= 4
  streakDays: number;
  lastStudyDate: string | null;
}

export interface QuizQuestion {
  id: string;
  checkpointId: string;
  type: 'recall' | 'multiple-choice' | 'true-false';
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
}

export interface RecapContent {
  title: string;
  keyPoints: string[];
  relatedCheckpoints: string[];
  suggestedQuestions: string[];
  generatedAt: number;
}

// Spaced repetition intervals (in days)
const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60, 120];

// IndexedDB setup
const DB_NAME = 'learning';
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains('checkpoints')) {
        const store = database.createObjectStore('checkpoints', { keyPath: 'id' });
        store.createIndex('threadId', 'threadId', { unique: false });
        store.createIndex('nextReview', 'nextReview', { unique: false });
        store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
      }

      if (!database.objectStoreNames.contains('progress')) {
        database.createObjectStore('progress', { keyPath: 'date' });
      }

      if (!database.objectStoreNames.contains('quizzes')) {
        const quizStore = database.createObjectStore('quizzes', { keyPath: 'id' });
        quizStore.createIndex('checkpointId', 'checkpointId', { unique: false });
      }
    };
  });
}

class LearningService {
  private learningModeEnabled = false;

  /**
   * Enable/disable learning mode
   */
  setLearningMode(enabled: boolean): void {
    this.learningModeEnabled = enabled;
    localStorage.setItem('learning_mode', String(enabled));
  }

  /**
   * Check if learning mode is enabled
   */
  isLearningMode(): boolean {
    if (this.learningModeEnabled) return true;
    return localStorage.getItem('learning_mode') === 'true';
  }

  /**
   * Create a checkpoint from chat content
   */
  async createCheckpoint(
    threadId: string,
    content: string,
    summary: string,
    tags: string[] = []
  ): Promise<Checkpoint> {
    const database = await getDb();
    const now = Date.now();

    const checkpoint: Checkpoint = {
      id: crypto.randomUUID(),
      threadId,
      content,
      summary,
      tags,
      createdAt: now,
      lastReviewed: null,
      nextReview: now + REVIEW_INTERVALS[0]! * 24 * 60 * 60 * 1000,
      reviewCount: 0,
      confidence: 0,
    };

    return new Promise((resolve, reject) => {
      const tx = database.transaction('checkpoints', 'readwrite');
      const store = tx.objectStore('checkpoints');
      const request = store.add(checkpoint);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.updateDailyProgress();
        resolve(checkpoint);
      };
    });
  }

  /**
   * Get all checkpoints for a thread
   */
  async getCheckpointsByThread(threadId: string): Promise<Checkpoint[]> {
    const database = await getDb();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('checkpoints', 'readonly');
      const store = tx.objectStore('checkpoints');
      const index = store.index('threadId');
      const request = index.getAll(threadId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  /**
   * Get checkpoints due for review
   */
  async getDueCheckpoints(): Promise<Checkpoint[]> {
    const database = await getDb();
    const now = Date.now();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('checkpoints', 'readonly');
      const store = tx.objectStore('checkpoints');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const all = request.result as Checkpoint[];
        const due = all.filter((c) => c.nextReview && c.nextReview <= now);
        resolve(due.sort((a, b) => (a.nextReview || 0) - (b.nextReview || 0)));
      };
    });
  }

  /**
   * Record a review and update spaced repetition schedule
   */
  async recordReview(checkpointId: string, confidence: number): Promise<void> {
    const database = await getDb();
    const now = Date.now();

    // Clamp confidence to 0-5
    confidence = Math.max(0, Math.min(5, Math.round(confidence)));

    return new Promise((resolve, reject) => {
      const tx = database.transaction('checkpoints', 'readwrite');
      const store = tx.objectStore('checkpoints');
      const request = store.get(checkpointId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const checkpoint = request.result as Checkpoint;
        if (!checkpoint) {
          reject(new Error('Checkpoint not found'));
          return;
        }

        checkpoint.lastReviewed = now;
        checkpoint.reviewCount += 1;
        checkpoint.confidence = confidence;

        // Calculate next review based on confidence (spaced repetition)
        const intervalIndex = Math.min(confidence, REVIEW_INTERVALS.length - 1);
        const interval = REVIEW_INTERVALS[intervalIndex]!;
        checkpoint.nextReview = now + interval * 24 * 60 * 60 * 1000;

        store.put(checkpoint);
        this.updateDailyProgress();
        resolve();
      };
    });
  }

  /**
   * Delete a checkpoint
   */
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    const database = await getDb();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('checkpoints', 'readwrite');
      const store = tx.objectStore('checkpoints');
      const request = store.delete(checkpointId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get learning progress stats
   */
  async getProgress(): Promise<LearningProgress> {
    const database = await getDb();
    const now = Date.now();

    return new Promise((resolve, reject) => {
      const tx = database.transaction(['checkpoints', 'progress'], 'readonly');
      const checkpointStore = tx.objectStore('checkpoints');
      const progressStore = tx.objectStore('progress');

      const checkpointRequest = checkpointStore.getAll();
      const progressRequest = progressStore.getAll();

      tx.oncomplete = () => {
        const checkpoints = checkpointRequest.result as Checkpoint[];
        const progressRecords = progressRequest.result as { date: string; studied: boolean }[];

        const totalCheckpoints = checkpoints.length;
        const reviewed = checkpoints.filter((c) => c.reviewCount > 0).length;
        const dueForReview = checkpoints.filter((c) => c.nextReview && c.nextReview <= now).length;
        const mastered = checkpoints.filter((c) => c.confidence >= 4).length;

        // Calculate streak
        let streakDays = 0;
        const today = new Date().toISOString().slice(0, 10);
        const sortedProgress = progressRecords
          .filter((p) => p.studied)
          .map((p) => p.date)
          .sort()
          .reverse();

        if (sortedProgress.length > 0) {
          let checkDate = new Date(today);
          for (const date of sortedProgress) {
            const expected = checkDate.toISOString().slice(0, 10);
            if (date === expected) {
              streakDays++;
              checkDate.setDate(checkDate.getDate() - 1);
            } else {
              break;
            }
          }
        }

        resolve({
          totalCheckpoints,
          reviewed,
          dueForReview,
          mastered,
          streakDays,
          lastStudyDate: sortedProgress[0] || null,
        });
      };

      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Update daily progress record
   */
  private async updateDailyProgress(): Promise<void> {
    const database = await getDb();
    const today = new Date().toISOString().slice(0, 10);

    return new Promise((resolve, reject) => {
      const tx = database.transaction('progress', 'readwrite');
      const store = tx.objectStore('progress');
      const request = store.put({ date: today, studied: true });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Generate quiz questions from checkpoints
   */
  generateQuizQuestions(checkpoint: Checkpoint): QuizQuestion[] {
    const questions: QuizQuestion[] = [];

    // Recall question
    questions.push({
      id: crypto.randomUUID(),
      checkpointId: checkpoint.id,
      type: 'recall',
      question: `What do you remember about: "${checkpoint.summary}"?`,
      correctAnswer: checkpoint.content,
    });

    // True/false question based on content
    questions.push({
      id: crypto.randomUUID(),
      checkpointId: checkpoint.id,
      type: 'true-false',
      question: `Is this statement accurate based on your learning: "${checkpoint.summary}"?`,
      options: ['True', 'False'],
      correctAnswer: 'True',
      explanation: checkpoint.content,
    });

    return questions;
  }

  /**
   * Get checkpoints by tags
   */
  async getCheckpointsByTag(tag: string): Promise<Checkpoint[]> {
    const database = await getDb();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('checkpoints', 'readonly');
      const store = tx.objectStore('checkpoints');
      const index = store.index('tags');
      const request = index.getAll(tag);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  /**
   * Get all unique tags
   */
  async getAllTags(): Promise<string[]> {
    const database = await getDb();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('checkpoints', 'readonly');
      const store = tx.objectStore('checkpoints');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const checkpoints = request.result as Checkpoint[];
        const tagSet = new Set<string>();
        checkpoints.forEach((c) => c.tags.forEach((t) => tagSet.add(t)));
        resolve(Array.from(tagSet).sort());
      };
    });
  }

  /**
   * Generate a recap for recent checkpoints
   */
  async generateRecap(checkpointIds: string[]): Promise<RecapContent> {
    const database = await getDb();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('checkpoints', 'readonly');
      const store = tx.objectStore('checkpoints');
      const keyPoints: string[] = [];
      let completed = 0;

      checkpointIds.forEach((id) => {
        const request = store.get(id);
        request.onsuccess = () => {
          const checkpoint = request.result as Checkpoint;
          if (checkpoint) {
            keyPoints.push(checkpoint.summary);
          }
          completed++;
          if (completed === checkpointIds.length) {
            resolve({
              title: 'Learning Recap',
              keyPoints,
              relatedCheckpoints: checkpointIds,
              suggestedQuestions: keyPoints.map((kp) => `Explain: ${kp}`),
              generatedAt: Date.now(),
            });
          }
        };
        request.onerror = () => {
          completed++;
          if (completed === checkpointIds.length) {
            reject(request.error);
          }
        };
      });

      if (checkpointIds.length === 0) {
        resolve({
          title: 'Learning Recap',
          keyPoints: [],
          relatedCheckpoints: [],
          suggestedQuestions: [],
          generatedAt: Date.now(),
        });
      }
    });
  }
}

export const learningService = new LearningService();
