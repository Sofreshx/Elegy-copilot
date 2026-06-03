# AI & Machine Learning

## ML Concepts

### Machine Learning (ML)
**Definition:** A subset of AI where systems learn patterns from data without being explicitly programmed for every rule, improving performance with more data.
**Usage:** Use for tasks that are hard to program explicitly — image recognition, language understanding, recommendation, anomaly detection. Distinguish from Deep Learning (neural network-based ML) and Traditional Programming (explicit rules).
**Related:** Deep Learning (subset of ML), Training (learning from data), Inference (making predictions), Model (the learned artifact)
**Tags:** ai, ml

### Deep Learning
**Definition:** A subset of ML using multi-layered neural networks to learn hierarchical representations from data, excelling at complex patterns.
**Usage:** Use for image/audio/text processing tasks where traditional ML approaches fall short. Requires more data and compute than traditional ML. Distinguish from ML (includes non-neural approaches) — Deep Learning uses deep neural networks.
**Related:** Neural Network (the architecture), Backpropagation (training algorithm), GPU (training hardware), Transformer (modern architecture)
**Tags:** ai, ml, deep-learning

### Supervised Learning
**Definition:** A training paradigm where the model learns from labeled data — input-output pairs — to predict outputs for new inputs.
**Usage:** Use when you have labeled historical data. Common tasks: classification (spam detection), regression (price prediction). Distinguish from Unsupervised (no labels) and Reinforcement Learning (reward-based).
**Related:** Unsupervised Learning (no labels), Reinforcement Learning (reward-based), Label (the ground truth), Training Set (labeled data)
**Tags:** ai, ml, supervised-learning

### Unsupervised Learning
**Definition:** A training paradigm where the model finds patterns in unlabeled data — clustering, dimensionality reduction, anomaly detection.
**Usage:** Use when you have data without labels and want to discover structure — customer segmentation, topic modeling, compression. Distinguish from Supervised Learning (labeled data) and Self-Supervised (creates labels from data).
**Related:** Supervised Learning (labeled), Clustering (grouping), Dimensionality Reduction (compression), Anomaly Detection (outlier finding)
**Tags:** ai, ml, unsupervised-learning

### Reinforcement Learning (RL)
**Definition:** A training paradigm where an agent learns by interacting with an environment, receiving rewards or penalties for actions, maximizing cumulative reward.
**Usage:** Use for sequential decision-making — game playing, robotics, resource optimization. Distinguish from Supervised Learning (static examples) — RL learns from trial and error.
**Related:** Agent (the learner), Environment (the world), Reward (feedback signal), Policy (action strategy), Q-Learning (RL algorithm)
**Tags:** ai, ml, reinforcement-learning

### Training
**Definition:** The process of teaching a model by exposing it to data and adjusting its parameters to minimize error between predictions and targets.
**Usage:** The core of ML development. Training requires data, a model architecture, a loss function, and an optimizer. Results in learned parameters (weights). Distinguish from Inference (using the trained model).
**Related:** Inference (using the model), Epoch (full pass over training data), Loss (prediction error), Overfitting (training too well)
**Tags:** ai, ml, training

### Inference
**Definition:** The process of running a trained model on new data to make predictions or generate outputs, without further learning.
**Usage:** What happens in production when the model processes user requests. Inference should be fast and efficient. Distinguish from Training (adjusting parameters) — Inference uses the fixed parameters.
**Related:** Training (the learning phase), Prediction (inference output), Throughput (inferences per second), Latency (time per inference)
**Tags:** ai, ml, inference

### Overfitting
**Definition:** When a model learns the training data too well, including noise and outliers, performing poorly on new, unseen data.
**Usage:** Identify by comparing training vs validation performance — large gap indicates overfitting. Prevent with regularization, early stopping, more data, or simpler models. Distinguish from Underfitting (model too simple, poor on all data).
**Related:** Underfitting (too simple), Regularization (anti-overfitting), Validation Set (detection), Cross-Validation (robust evaluation)
**Tags:** ai, ml, overfitting

## LLMs

### LLM (Large Language Model)
**Definition:** A neural network model trained on vast text data to generate, understand, and manipulate human language, typically using the Transformer architecture.
**Usage:** Use for text generation, summarization, translation, question answering, code generation, and chatbot applications. Size ranges from billions to trillions of parameters. Distinguish from SLM (smaller, cheaper, domain-specific).
**Related:** SLM (smaller model), Transformer (the architecture), Token (text unit), Parameter (model weight)
**Tags:** ai, llm

### SLM (Small Language Model)
**Definition:** A smaller, more efficient language model (usually <10B parameters) optimized for specific domains or edge devices with lower compute requirements.
**Usage:** Use when LLM costs or latency are prohibitive, or for domain-specific tasks where a general LLM is overkill. Distinguish from LLM (larger, more capable, more expensive).
**Related:** LLM (larger model), Distillation (training SLM from LLM), Quantization (reducing precision), On-device (SLM deployment)
**Tags:** ai, llm, slm

### Token
**Definition:** The basic unit of text that an LLM processes — a word, subword, or character, depending on the tokenizer. Typically ~0.75 words per token in English.
**Usage:** The unit of billing and context window measurement. Models have input/output token limits. Distinguish from Word (not always aligned) — Tokens are the model's vocabulary units.
**Related:** Tokenizer (text ↔ tokens), Context Window (max tokens), Vocabulary (the token set), Token Limit (max input/output)
**Tags:** ai, llm, token

### Context Window
**Definition:** The maximum number of tokens an LLM can process in a single input (prompt + conversation history), limiting how much context it can consider.
**Usage:** Larger context windows (128K+, 1M+ tokens) enable processing entire documents or long conversations. Distinguish from Working Memory (what the model maintains across turns) — Context Window is the fixed input limit.
**Related:** Token (context window unit), Long Context (large window), RAG (alternative for larger context), Attention (context mechanism)
**Tags:** ai, llm, context-window

### Hallucination
**Definition:** When an LLM generates plausible-sounding but factually incorrect or fabricated information, with no awareness of its inaccuracy.
**Usage:** A fundamental limitation of LLMs — they don't know what they don't know. Mitigate with RAG (grounding in retrieved docs), prompt engineering (cite sources), and human validation. Distinguish from Misinformation (intentional falsehood).
**Related:** RAG (grounding to reduce hallucination), Factuality (truthfulness), Calibration (confidence vs accuracy), Confabulation (synonym)
**Tags:** ai, llm, hallucination

### Temperature
**Definition:** A parameter controlling the randomness of token selection — lower temperature (0-0.3) produces more deterministic, focused outputs; higher (0.7-1.5) produces more creative, varied outputs.
**Usage:** Use low temperature for factual tasks (QA, coding), high temperature for creative tasks (storytelling, brainstorming). Distinguish from Top-p (nucleus sampling, alternative randomness control).
**Related:** Top-p (alternative), Top-k (alternative), Sampling (temperature mechanism), Determinism (low temp = more deterministic)
**Tags:** ai, llm, temperature

## Prompting

### Prompt
**Definition:** The input text provided to an LLM to guide its output, including instructions, context, and formatting cues.
**Usage:** The primary interface for controlling LLM behavior. A well-crafted prompt specifies the task, format, tone, and constraints. Distinguish from System Prompt (pre-set instructions) and User Prompt (the user's request).
**Related:** System Prompt (pre-set instructions), Few-shot (including examples), Instruction (explicit direction), Chain-of-Thought (step-by-step reasoning)
**Tags:** ai, prompting, prompt

### System Prompt
**Definition:** The pre-set instruction placed in the model's context before user messages, defining its behavior, capabilities, constraints, and persona.
**Usage:** Use to set the model's role, output format rules, and behavioral guardrails. The system prompt is not visible to the end user. Distinguish from User Prompt (the user's request) — System Prompt is the authority layer.
**Related:** Prompt (generic), Instruction (explicit direction), Persona (role assignment), Guardrail (behavior constraint)
**Tags:** ai, prompting, system-prompt

### Few-shot Prompting
**Definition:** A technique where the prompt includes a few examples of the desired input-output pairs before asking for the target output.
**Usage:** Use when the model needs to learn a pattern or format from examples rather than explicit instructions. More examples improve accuracy. Distinguish from Zero-shot (no examples) and One-shot (single example).
**Related:** Zero-shot (no examples), One-shot (one example), In-context Learning (examples as learning), Few-shot Fine-tuning (training with few examples)
**Tags:** ai, prompting, few-shot

### Zero-shot Prompting
**Definition:** Asking an LLM to perform a task with no examples, relying entirely on its pre-training knowledge and general instruction-following ability.
**Usage:** Use for well-defined tasks the model likely learned during training. Less reliable than few-shot for unusual formats. Distinguish from Few-shot (uses examples) — Zero-shot provides none.
**Related:** Few-shot (with examples), Instruction-following (zero-shot capability), Prompt Engineering (zero-shot optimization)
**Tags:** ai, prompting, zero-shot

### Chain-of-Thought (CoT)
**Definition:** A prompting technique that asks the model to reason step-by-step before giving the final answer, improving accuracy on complex reasoning tasks.
**Usage:** Use for math, logic, planning, or any task requiring multi-step reasoning. Append "Let's think step by step" to the prompt. Distinguish from Direct Answer (single response) — CoT reveals the reasoning process.
**Related:** Reasoning (the goal), Step-by-step (the approach), Tree-of-Thought (multiple reasoning paths), ReAct (reasoning + acting)
**Tags:** ai, prompting, chain-of-thought

### ReAct (Reasoning + Acting)
**Definition:** A prompting framework where the model reasons about a task, takes an action (search, compute, tool call), observes the result, and continues — iteratively.
**Usage:** Use for tasks requiring external information or tool use. The model thinks, acts, observes, and repeats until the task is complete. Distinguish from CoT (thinking only, no actions) — ReAct includes actions.
**Related:** Chain-of-Thought (thinking only), Tool Use (acting), Agent (ReAct-based system), Observation (action result)
**Tags:** ai, prompting, react

## AI Architecture

### RAG (Retrieval-Augmented Generation)
**Definition:** A technique where an LLM's response is grounded in information retrieved from an external knowledge base, improving factuality and reducing hallucination.
**Usage:** Use for question answering over private documents, customer support, or any scenario where the model needs access to information not in its training data. The retrieval step finds relevant context; the generation step produces the answer from that context.
**Related:** Embedding (document retrieval), Vector DB (similarity search), Hallucination (what RAG reduces), Grounding (connecting to sources)
**Tags:** ai, architecture, rag

### Embedding
**Definition:** A dense vector representation of text (or images, audio) in a high-dimensional space, where semantically similar content is close together.
**Usage:** Use for semantic search, clustering, recommendation, and RAG retrieval. Embeddings are generated by specialized models. Distinguish from Token (LLM input unit) — Embeddings represent meaning, not text.
**Related:** Vector DB (stores embeddings), Similarity Search (finds nearest neighbors), Cosine Similarity (distance metric), Sentence Transformer (embedding model)
**Tags:** ai, architecture, embedding

### Agent (AI)
**Definition:** An AI system that can perceive its environment, reason, plan, use tools, and take actions to achieve goals, often powered by an LLM as the reasoning engine.
**Usage:** Use for autonomous task completion (coding agents, customer support agents, research agents). An agent typically has: LLM (reasoning), tools (actions), memory (context), and a loop (plan → act → observe). Distinguish from RAG (retrieval-only) — Agents act.
**Related:** Tool (agent action), Memory (agent state), Orchestrator (agent coordination), Loop (observe-think-act)
**Tags:** ai, architecture, agent

### Tool (AI)
**Definition:** A function or API that an AI agent can call to interact with external systems — search, calculator, database query, file operations, API calls.
**Usage:** Use to give agents the ability to affect real-world systems. Tools are defined with a name, description, parameters, and an implementation. Distinguish from Plugin (broader, may include UI) — Tool is function-call level.
**Related:** Function Calling (API mechanism), Agent (the tool user), Tool Description (for model selection), Tool Registry (available tools)
**Tags:** ai, architecture, tool

### Fine-tuning
**Definition:** The process of further training a pre-trained model on a smaller, domain-specific dataset to adapt it for specialized tasks or improve performance.
**Usage:** Use when a pre-trained model needs domain expertise (legal, medical, code) or specific behavioral alignment. Cheaper than training from scratch. Distinguish from RAG (adds context, doesn't change model) and Pre-training (initial, large-scale training).
**Related:** Pre-training (initial training), LoRA (efficient fine-tuning), RLHF (fine-tuning with human feedback), Distillation (SLM from LLM)
**Tags:** ai, fine-tuning

### LoRA (Low-Rank Adaptation)
**Definition:** An efficient fine-tuning technique that trains small, low-rank weight matrices instead of updating all model parameters, drastically reducing compute requirements.
**Usage:** Use when you need to fine-tune a large model but have limited compute. LoRA adapters are small files that can be swapped for different tasks without duplicating the base model. Distinguish from Full Fine-tuning (updates all parameters, expensive).
**Related:** Fine-tuning (the goal), QLoRA (quantized LoRA), Adapter (the trained module), Base Model (the frozen model)
**Tags:** ai, fine-tuning, lora

### RLHF (Reinforcement Learning from Human Feedback)
**Definition:** A technique that fine-tunes an LLM using human preferences as a reward signal, aligning model outputs with human values and expectations.
**Usage:** Use for training models to be more helpful, harmless, and honest. Human raters compare model outputs; the model learns to prefer the one humans choose. Distinguish from Supervised Fine-tuning (example-based) — RLHF uses preferences.
**Related:** Alignment (the goal), Preference (human choice), Reward Model (learns from human ratings), Constitutional AI (RLHF alternative)
**Tags:** ai, fine-tuning, rlhf

### Distillation
**Definition:** Training a smaller "student" model to mimic a larger "teacher" model's behavior, compressing knowledge into a more efficient form.
**Usage:** Use when you want a model with similar capabilities to a large model but cheaper/faster to run. The student learns from the teacher's outputs, not from raw training data. Distinguish from Quantization (numeric precision reduction) — Distillation changes the model architecture.
**Related:** Teacher-Student (the relationship), Quantization (alternative compression), Pruning (removing parameters), On-device (distilled model deployment)
**Tags:** ai, distillation

### Vector DB
**Definition:** A database optimized for storing and querying vector embeddings using similarity search (cosine similarity, Euclidean distance, dot product).
**Usage:** Use for RAG pipelines, semantic search, recommendation systems, and any AI workflow requiring similarity-based retrieval. Distinguish from Traditional DB (exact match, range queries) — Vector DB supports nearest-neighbor search.
**Related:** Embedding (stored vector), ANN (approximate nearest neighbor), Index (vector index), Similarity Search (the query)
**Tags:** ai, architecture, vector-db
