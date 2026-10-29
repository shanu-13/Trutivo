"""Fixed material for rule-based mock interviews (Step 16).

SKILL_CONCEPTS maps canonical skill names (app/data/skills.py) to the core
concepts an answer about that skill is expected to touch, each with the words
that show it was covered. Skills without an entry use their category's
concepts, then GENERAL_TECHNICAL_CONCEPTS. Questions only ever name skills
taken from the resume or the job, and frames never claim the candidate has
experience the resume does not show.
"""

GENERATOR_VERSION = "1.0"
RULES_VERSION = "1.0"

Concept = tuple[str, tuple[str, ...]]

SKILL_CONCEPTS: dict[str, list[Concept]] = {
    "Python": [
        ("core data structures", ("list", "dict", "dictionary", "set", "tuple")),
        ("error handling", ("exception", "try", "except", "raise", "error handling")),
        ("generators and iterators", ("generator", "yield", "iterator", "lazy")),
        ("packaging and environments", ("pip", "venv", "virtual environment", "package", "dependency")),
        ("testing", ("pytest", "unittest", "test", "mock")),
    ],
    "JavaScript": [
        ("asynchronous code", ("promise", "async", "await", "callback", "event loop")),
        ("scope and closures", ("closure", "scope", "let", "const", "hoisting")),
        ("the DOM and events", ("dom", "event", "listener", "bubbling")),
        ("equality and types", ("===", "type coercion", "typeof", "undefined", "null")),
    ],
    "TypeScript": [
        ("static types", ("type", "types", "interface", "type safety", "compile")),
        ("generics", ("generic", "generics", "<t>")),
        ("union and narrowing", ("union", "narrowing", "type guard", "discriminated")),
        ("strict mode and any", ("strict", "any", "unknown", "never")),
    ],
    "Java": [
        ("object-oriented design", ("class", "interface", "inheritance", "polymorphism", "encapsulation")),
        ("collections", ("list", "map", "set", "arraylist", "hashmap", "collection")),
        ("exceptions", ("exception", "checked", "unchecked", "try", "catch")),
        ("concurrency", ("thread", "concurrency", "synchronized", "executor", "lock")),
        ("JVM and memory", ("jvm", "garbage collection", "heap", "memory")),
    ],
    "C": [
        ("pointers and memory", ("pointer", "malloc", "free", "memory", "address")),
        ("undefined behaviour", ("undefined behaviour", "undefined behavior", "overflow", "bounds")),
        ("compilation and linking", ("compile", "linker", "header", "makefile")),
    ],
    "C++": [
        ("memory and RAII", ("raii", "destructor", "smart pointer", "unique_ptr", "shared_ptr", "memory")),
        ("templates", ("template", "generic", "stl")),
        ("move semantics", ("move", "rvalue", "copy constructor", "copy")),
        ("object-oriented design", ("class", "virtual", "inheritance", "polymorphism")),
    ],
    "C#": [
        ("object-oriented design", ("class", "interface", "inheritance", "polymorphism")),
        ("async and tasks", ("async", "await", "task")),
        ("LINQ", ("linq", "query", "ienumerable")),
        ("memory management", ("garbage collection", "dispose", "using", "memory")),
    ],
    "Go": [
        ("goroutines and channels", ("goroutine", "channel", "concurrency", "select")),
        ("error handling", ("error", "errors", "err != nil", "wrap")),
        ("interfaces", ("interface", "implicit", "struct")),
    ],
    "Rust": [
        ("ownership and borrowing", ("ownership", "borrow", "borrowing", "lifetime")),
        ("error handling", ("result", "option", "error", "unwrap", "question mark operator")),
        ("memory safety", ("memory safety", "safe", "unsafe", "data race")),
    ],
    "PHP": [
        ("request handling", ("request", "session", "form", "http")),
        ("security", ("sql injection", "prepared statement", "xss", "escape", "validation")),
        ("frameworks and composer", ("laravel", "symfony", "composer", "framework")),
    ],
    "Ruby": [
        ("blocks and iterators", ("block", "yield", "each", "map", "proc", "lambda")),
        ("Rails conventions", ("rails", "activerecord", "convention", "mvc")),
        ("testing", ("rspec", "test", "minitest")),
    ],
    "React": [
        ("components and props", ("component", "components", "props", "jsx")),
        ("state and hooks", ("state", "usestate", "hook", "hooks", "useeffect")),
        ("rendering and performance", ("render", "re-render", "memo", "usememo", "virtual dom", "key")),
        ("data fetching and effects", ("fetch", "effect", "useeffect", "loading", "api")),
    ],
    "Next.js": [
        ("routing", ("route", "routing", "app router", "pages", "layout")),
        ("server and client components", ("server component", "client component", "use client", "server")),
        ("rendering modes", ("ssr", "server-side rendering", "static", "ssg", "isr")),
        ("data fetching", ("fetch", "data", "cache", "revalidate")),
    ],
    "Angular": [
        ("components and modules", ("component", "module", "standalone", "decorator")),
        ("dependency injection", ("dependency injection", "service", "injectable", "provider")),
        ("RxJS and observables", ("rxjs", "observable", "subscribe", "pipe")),
    ],
    "Vue.js": [
        ("components and props", ("component", "props", "emit", "template")),
        ("reactivity", ("reactive", "ref", "computed", "watch", "reactivity")),
        ("state management", ("pinia", "vuex", "store", "state")),
    ],
    "HTML": [
        ("semantic markup", ("semantic", "header", "nav", "main", "article", "section")),
        ("accessibility", ("accessibility", "aria", "alt", "label", "screen reader")),
        ("forms", ("form", "input", "label", "validation")),
    ],
    "CSS": [
        ("layout", ("flexbox", "grid", "layout", "position")),
        ("responsive design", ("responsive", "media query", "breakpoint", "mobile")),
        ("specificity and cascade", ("specificity", "cascade", "selector", "inheritance")),
    ],
    "Tailwind CSS": [
        ("utility classes", ("utility", "class", "classes")),
        ("responsive variants", ("responsive", "breakpoint", "md:", "sm:", "variant")),
        ("configuration and theming", ("config", "theme", "design token", "custom")),
    ],
    "Bootstrap": [
        ("grid system", ("grid", "row", "col", "column", "breakpoint")),
        ("components", ("component", "modal", "navbar", "button")),
        ("customisation", ("sass", "variable", "theme", "custom")),
    ],
    "Node.js": [
        ("event loop and non-blocking I/O", ("event loop", "non-blocking", "asynchronous", "async", "callback")),
        ("modules and packages", ("module", "require", "import", "npm", "package")),
        ("error handling", ("error", "try", "catch", "promise", "reject")),
        ("streams", ("stream", "buffer", "pipe")),
    ],
    "Express.js": [
        ("routing", ("route", "router", "get", "post", "endpoint")),
        ("middleware", ("middleware", "next", "app.use")),
        ("error handling", ("error handler", "error", "status code", "next(err)")),
        ("validation and security", ("validation", "validate", "cors", "authentication", "sanitize")),
    ],
    "Django": [
        ("models and ORM", ("model", "orm", "queryset", "migration")),
        ("views and URLs", ("view", "url", "urls", "template")),
        ("security features", ("csrf", "authentication", "permission", "middleware")),
    ],
    "Flask": [
        ("routes and views", ("route", "view", "blueprint")),
        ("request context", ("request", "context", "g", "session")),
        ("extensions", ("extension", "sqlalchemy", "flask-login")),
    ],
    "FastAPI": [
        ("path operations", ("route", "endpoint", "path operation", "get", "post")),
        ("validation with Pydantic", ("pydantic", "model", "validation", "schema")),
        ("dependency injection", ("depends", "dependency", "injection")),
        ("async endpoints", ("async", "await", "asynchronous")),
    ],
    "Spring Boot": [
        ("dependency injection", ("dependency injection", "bean", "autowired", "component")),
        ("REST controllers", ("controller", "restcontroller", "endpoint", "mapping")),
        ("data access", ("jpa", "repository", "hibernate", "entity")),
        ("configuration", ("application.properties", "profile", "configuration")),
    ],
    ".NET": [
        ("dependency injection", ("dependency injection", "service", "container")),
        ("ASP.NET Core APIs", ("controller", "endpoint", "middleware", "asp.net")),
        ("Entity Framework", ("entity framework", "ef core", "dbcontext", "migration")),
    ],
    "MySQL": [
        ("schema design", ("schema", "table", "normalization", "normalisation", "primary key", "foreign key")),
        ("indexes and performance", ("index", "indexes", "explain", "query plan", "performance")),
        ("transactions", ("transaction", "commit", "rollback", "acid", "isolation")),
        ("joins and queries", ("join", "joins", "group by", "subquery", "query")),
    ],
    "PostgreSQL": [
        ("schema design", ("schema", "table", "normalization", "primary key", "foreign key")),
        ("indexes and performance", ("index", "explain", "query plan", "performance")),
        ("transactions", ("transaction", "commit", "rollback", "acid", "isolation", "mvcc")),
        ("advanced types", ("jsonb", "array", "enum", "extension")),
    ],
    "MongoDB": [
        ("document model", ("document", "collection", "bson", "schema")),
        ("indexes", ("index", "indexes", "query", "performance")),
        ("aggregation", ("aggregation", "pipeline", "$match", "$group")),
        ("consistency and transactions", ("transaction", "replica", "consistency", "write concern")),
    ],
    "Redis": [
        ("data structures", ("string", "hash", "list", "set", "sorted set")),
        ("caching", ("cache", "caching", "ttl", "expire", "eviction")),
        ("persistence and availability", ("persistence", "rdb", "aof", "replication")),
    ],
    "SQLite": [
        ("embedded database", ("embedded", "file", "local", "serverless")),
        ("transactions and locking", ("transaction", "lock", "wal", "concurrency")),
        ("schema and queries", ("table", "query", "index", "schema")),
    ],
    "Oracle": [
        ("SQL and PL/SQL", ("pl/sql", "procedure", "sql", "query")),
        ("indexes and performance", ("index", "explain plan", "performance", "partition")),
        ("transactions", ("transaction", "commit", "rollback", "isolation")),
    ],
    "AWS": [
        ("core services", ("ec2", "s3", "lambda", "rds", "service")),
        ("identity and access", ("iam", "role", "policy", "permission", "least privilege")),
        ("networking", ("vpc", "subnet", "security group", "load balancer")),
        ("cost and scaling", ("cost", "auto scaling", "autoscaling", "scale", "region")),
    ],
    "Azure": [
        ("core services", ("app service", "function", "blob", "vm", "service")),
        ("identity and access", ("active directory", "entra", "rbac", "role", "identity")),
        ("deployment", ("resource group", "arm", "bicep", "pipeline", "deploy")),
    ],
    "Google Cloud": [
        ("core services", ("compute engine", "cloud run", "cloud storage", "bigquery", "service")),
        ("identity and access", ("iam", "service account", "role", "permission")),
        ("deployment", ("deploy", "gke", "cloud build", "region")),
    ],
    "Docker": [
        ("images and containers", ("image", "container", "dockerfile", "layer")),
        ("builds and layers", ("layer", "cache", "multi-stage", "build")),
        ("networking and volumes", ("volume", "network", "port", "compose")),
        ("security", ("non-root", "root", "secret", "minimal", "scan")),
    ],
    "Kubernetes": [
        ("pods and deployments", ("pod", "deployment", "replica", "replicaset")),
        ("services and networking", ("service", "ingress", "load balancer", "dns")),
        ("configuration", ("configmap", "secret", "environment")),
        ("scaling and health", ("autoscaling", "hpa", "liveness", "readiness", "probe")),
    ],
    "Git": [
        ("branching and merging", ("branch", "merge", "rebase", "pull request")),
        ("conflicts", ("conflict", "resolve", "diff")),
        ("history", ("commit", "log", "revert", "reset", "history")),
    ],
    "GitHub": [
        ("pull requests and review", ("pull request", "review", "pr", "approve")),
        ("automation", ("github actions", "workflow", "ci", "action")),
        ("collaboration", ("issue", "branch", "fork", "protection")),
    ],
    "GitLab": [
        ("merge requests and review", ("merge request", "review", "approve")),
        ("CI/CD pipelines", ("pipeline", ".gitlab-ci", "stage", "job", "runner")),
        ("collaboration", ("issue", "branch", "protected")),
    ],
    "Jira": [
        ("issue tracking", ("issue", "ticket", "story", "bug", "epic")),
        ("agile workflow", ("sprint", "backlog", "board", "kanban", "scrum")),
        ("prioritisation", ("priority", "prioritise", "prioritize", "estimate")),
    ],
    "Postman": [
        ("API requests", ("request", "endpoint", "header", "body", "status")),
        ("collections and environments", ("collection", "environment", "variable")),
        ("automated tests", ("test", "assertion", "newman", "script")),
    ],
    "Machine Learning": [
        ("training and evaluation", ("train", "training", "test set", "validation", "evaluate", "metric")),
        ("overfitting", ("overfitting", "underfitting", "regularization", "regularisation", "cross-validation")),
        ("features and data", ("feature", "data", "preprocessing", "cleaning", "label")),
        ("model choice", ("model", "algorithm", "baseline", "regression", "classification")),
    ],
    "Deep Learning": [
        ("neural networks", ("neural network", "layer", "neuron", "activation")),
        ("training", ("backpropagation", "gradient", "loss", "optimizer", "epoch")),
        ("overfitting", ("overfitting", "dropout", "regularization", "augmentation")),
    ],
    "NLP": [
        ("text preprocessing", ("tokenization", "tokenize", "stemming", "lemmatization", "stop words")),
        ("representations", ("embedding", "vector", "tf-idf", "bag of words")),
        ("models and evaluation", ("transformer", "classification", "accuracy", "f1", "model")),
    ],
    "TensorFlow": [
        ("models and layers", ("keras", "layer", "model", "sequential")),
        ("training", ("fit", "loss", "optimizer", "epoch", "gradient")),
        ("deployment", ("savedmodel", "serving", "export", "tflite")),
    ],
    "PyTorch": [
        ("tensors and autograd", ("tensor", "autograd", "gradient", "backward")),
        ("models and training loops", ("nn.module", "module", "training loop", "optimizer", "loss")),
        ("data loading", ("dataset", "dataloader", "batch")),
    ],
    "Scikit-learn": [
        ("estimators and pipelines", ("estimator", "pipeline", "fit", "predict", "transform")),
        ("model evaluation", ("cross-validation", "train_test_split", "score", "metric", "accuracy")),
        ("preprocessing", ("scaler", "encoding", "preprocessing", "feature")),
    ],
    "Pandas": [
        ("DataFrames", ("dataframe", "series", "column", "index")),
        ("cleaning data", ("missing", "nan", "dropna", "fillna", "clean")),
        ("grouping and joining", ("groupby", "merge", "join", "aggregate", "pivot")),
    ],
    "NumPy": [
        ("arrays", ("array", "ndarray", "shape", "dtype")),
        ("vectorisation", ("vectorization", "vectorisation", "broadcasting", "loop")),
        ("numerical operations", ("matrix", "dot", "mean", "linear algebra")),
    ],
    "REST API": [
        ("resources and HTTP methods", ("resource", "get", "post", "put", "delete", "http method")),
        ("status codes", ("status code", "200", "201", "400", "401", "404", "500")),
        ("statelessness and authentication", ("stateless", "authentication", "token", "jwt", "session")),
        ("versioning and pagination", ("versioning", "version", "pagination", "page")),
    ],
    "GraphQL": [
        ("schema and types", ("schema", "type", "query", "mutation")),
        ("resolvers", ("resolver", "resolvers", "field")),
        ("performance", ("n+1", "dataloader", "batching", "caching")),
    ],
    "Microservices": [
        ("service boundaries", ("boundary", "bounded context", "domain", "independent", "decouple")),
        ("communication", ("rest", "message", "queue", "event", "grpc", "asynchronous")),
        ("data ownership", ("database per service", "data", "consistency", "eventual consistency")),
        ("observability and resilience", ("logging", "tracing", "monitoring", "retry", "circuit breaker", "timeout")),
    ],
    "Linux": [
        ("command line and files", ("shell", "bash", "command", "file", "directory")),
        ("permissions", ("permission", "chmod", "chown", "user", "group", "sudo")),
        ("processes and services", ("process", "systemd", "service", "kill", "ps")),
    ],
    "CI/CD": [
        ("pipelines", ("pipeline", "stage", "build", "workflow")),
        ("automated testing", ("test", "tests", "automated", "lint")),
        ("deployment strategies", ("deploy", "deployment", "rollback", "blue-green", "canary")),
        ("secrets and environments", ("secret", "environment", "staging", "production")),
    ],
}

CATEGORY_CONCEPTS: dict[str, list[Concept]] = {
    "programming_languages": [
        ("language fundamentals", ("type", "function", "variable", "syntax")),
        ("error handling", ("error", "exception", "handle")),
        ("testing", ("test", "unit test", "testing")),
    ],
    "frontend": [
        ("components", ("component", "ui", "render")),
        ("state", ("state", "data", "props")),
        ("accessibility", ("accessibility", "aria", "keyboard", "label")),
    ],
    "backend": [
        ("API design", ("api", "endpoint", "route", "request", "response")),
        ("validation and errors", ("validation", "error", "status code")),
        ("data access", ("database", "query", "orm")),
    ],
    "databases": [
        ("schema design", ("schema", "table", "key", "model")),
        ("indexes", ("index", "performance", "query")),
        ("transactions", ("transaction", "consistency", "commit")),
    ],
    "cloud": [
        ("deployment", ("deploy", "service", "environment")),
        ("security", ("permission", "role", "secret", "access")),
        ("scaling", ("scale", "load", "availability")),
    ],
    "tools": [
        ("workflow", ("workflow", "process", "team")),
        ("collaboration", ("review", "share", "collaborate")),
    ],
    "ai_ml": [
        ("data preparation", ("data", "feature", "cleaning", "preprocessing")),
        ("training and evaluation", ("train", "evaluate", "metric", "validation")),
    ],
    "other": [
        ("design", ("design", "architecture", "pattern")),
        ("reliability", ("error", "monitoring", "test")),
    ],
}

GENERAL_TECHNICAL_CONCEPTS: list[Concept] = [
    ("problem breakdown", ("break down", "step", "approach", "requirement")),
    ("testing and verification", ("test", "verify", "edge case")),
    ("trade-offs", ("trade-off", "tradeoff", "alternative", "pros", "cons")),
]

# Generic technical questions, used when neither the resume nor the job names a known skill.
GENERAL_TECHNICAL_QUESTIONS: list[tuple[str, str, list[Concept]]] = [
    (
        "debugging",
        "Walk through how you approach debugging a problem you cannot reproduce easily.",
        [
            ("reproducing the issue", ("reproduce", "logs", "steps", "environment")),
            ("narrowing the cause", ("isolate", "hypothesis", "narrow", "bisect")),
            ("verifying the fix", ("test", "verify", "regression")),
        ],
    ),
    (
        "code quality",
        "How do you keep code readable and maintainable when working with others?",
        [
            ("code review", ("review", "pull request", "feedback")),
            ("tests", ("test", "tests", "coverage")),
            ("naming and structure", ("naming", "structure", "function", "module", "refactor")),
        ],
    ),
    (
        "learning new technology",
        "How do you learn a new technology or tool that a project needs?",
        [
            ("learning approach", ("documentation", "docs", "tutorial", "course", "practice")),
            ("applying it", ("project", "prototype", "build", "apply")),
            ("checking understanding", ("review", "feedback", "test", "mentor")),
        ],
    ),
]

# Technical frames per difficulty. {skill}, {concepts} and {role} are filled in.
# {concepts} is a "; "-separated list (labels can themselves contain "and").
TECHNICAL_FRAMES = {
    "beginner": "What is {skill}, and what is it typically used for in a role like {role}? Cover: {concepts}.",
    "intermediate": "In {skill}, explain the following and describe when and how you would apply them in practice: {concepts}.",
    "advanced": "For {skill} in a production {role} system, what trade-offs and failure cases would you consider around: {concepts}? How would you detect and handle problems?",
}
# Added in front of the frame, depending on where the skill comes from.
TECHNICAL_LEADS = {
    "resume_and_job": "This role asks for {skill}, which your resume lists{reference}. ",
    "job": "This role asks for {skill}. Your resume does not list it, so answer from what you know and be clear about where your experience is limited. ",
    "resume": "Your resume lists {skill}{reference}. ",
}
TECHNICAL_GUIDANCE = "Explain the idea clearly, give a concrete example, and only describe work you have actually done."

STAR: list[Concept] = [
    ("situation (context)", ("when", "while", "during", "at my", "in my", "situation", "project", "team", "we were")),
    ("task (your responsibility)", ("my task", "my role", "responsible", "i needed", "i had to", "goal", "was asked")),
    ("action (what you did)", ("i decided", "i built", "i led", "i organised", "i organized", "i created", "i proposed", "i worked", "i spoke", "i set up", "i wrote", "i implemented", "i started", "i took")),
    ("result (outcome and learning)", ("result", "outcome", "as a result", "in the end", "learned", "learnt", "improved", "reduced", "increased", "saved", "delivered")),
]

# Behavioural competencies: (focus, question, extra expected points).
BEHAVIORAL_QUESTIONS: list[tuple[str, str, list[Concept]]] = [
    ("teamwork", "describe a time you worked closely with others to deliver something. What was your part?", [("collaboration", ("team", "together", "collaborat", "colleague", "we"))]),
    ("handling conflict", "describe a disagreement with a colleague or teammate and how it was resolved.", [("resolution approach", ("listen", "discuss", "compromise", "agree", "understand"))]),
    ("learning from a mistake", "describe a mistake you made, how you handled it and what you changed afterwards.", [("ownership", ("my mistake", "i was responsible", "owned", "took responsibility", "admitted")), ("lesson", ("learned", "learnt", "now i", "since then", "changed"))]),
    ("working under pressure", "describe a time you had a tight deadline. How did you prioritise?", [("prioritisation", ("priorit", "first", "most important", "plan", "scope"))]),
    ("initiative", "describe a time you improved something without being asked.", [("initiative", ("noticed", "proposed", "suggested", "on my own", "volunteered"))]),
    ("learning quickly", "describe a time you had to learn something new quickly to get work done.", [("learning approach", ("documentation", "learned", "practice", "asked", "course", "tutorial"))]),
    ("receiving feedback", "describe feedback you received and what you did with it.", [("acting on feedback", ("feedback", "changed", "improved", "applied", "adjusted"))]),
    ("leadership", "describe a time you guided or supported others towards a goal.", [("guiding others", ("guided", "mentored", "helped", "coordinated", "led", "supported"))]),
]
BEHAVIORAL_LEADS = {
    "with_role": "Thinking of your time as {reference} (or another real experience), ",
    "general": "From work, study or a project you were really part of, ",
}
BEHAVIORAL_ADVANCED_SUFFIX = " What would you do differently now, and how did you know the outcome was successful?"
BEHAVIORAL_GUIDANCE = "Use a real example and structure it as Situation, Task, Action, Result (STAR). If you have no directly matching example, say so and use the closest real one."

# HR questions: (focus, question frame, expected points). {role} and {company} are filled in.
HR_QUESTIONS: list[tuple[str, str, list[Concept]]] = [
    (
        "motivation for the role",
        "Why are you interested in the {role} role{at_company}?",
        [
            ("interest in the role", ("interested", "interest", "excited", "enjoy", "motivated", "because")),
            ("link to your background", ("experience", "skills", "background", "worked", "studied")),
            ("what you would contribute", ("contribute", "bring", "help", "value", "add")),
        ],
    ),
    (
        "introducing yourself",
        "Tell me about yourself and how your background leads to this {role} role.",
        [
            ("current situation", ("currently", "i am", "i'm", "at the moment", "recently")),
            ("relevant experience", ("experience", "worked", "project", "skills", "built")),
            ("why this role next", ("next", "looking for", "this role", "now", "goal")),
        ],
    ),
    (
        "relevant strengths",
        "Which of your strengths are most relevant to this {role} role, and what evidence shows them?",
        [
            ("named strengths", ("strength", "good at", "strong", "skill")),
            ("evidence", ("for example", "for instance", "when i", "project", "result")),
            ("relevance to the role", ("role", "this job", "position", "team")),
        ],
    ),
    (
        "career goals",
        "Where would you like your career to go over the next few years, and how does this role fit?",
        [
            ("goals", ("goal", "aim", "want to", "hope", "plan")),
            ("fit with this role", ("this role", "position", "fit", "opportunity")),
            ("growth", ("learn", "grow", "develop", "improve")),
        ],
    ),
    (
        "working style",
        "How do you prefer to work in a team, and how do you handle priorities that change?",
        [
            ("working style", ("prefer", "communicat", "team", "collaborat")),
            ("handling change", ("change", "adapt", "priorit", "flexible", "re-plan")),
        ],
    ),
]
HR_GUIDANCE = "Be specific and honest: connect your answer to this role and to things you have actually done."

# Share of each type in a mixed interview, in the order questions are interleaved.
MIXED_PATTERN = ["technical", "behavioral", "technical", "hr", "technical", "behavioral"]
