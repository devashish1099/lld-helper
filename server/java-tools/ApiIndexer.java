import java.lang.reflect.*;
import java.util.*;

/**
 * Dumps public constructors, methods and fields of commonly used JDK classes as JSON.
 * Run once per JDK by LLD Studio to power its lightweight autocomplete.
 */
public class ApiIndexer {
    static final String[] CLASSES = {
        "java.lang.Object", "java.lang.String", "java.lang.StringBuilder", "java.lang.Math", "java.lang.Integer",
        "java.lang.Long", "java.lang.Double", "java.lang.Float", "java.lang.Boolean", "java.lang.Character",
        "java.lang.Byte", "java.lang.Short", "java.lang.Number", "java.lang.System", "java.lang.Thread", "java.lang.Runnable",
        "java.lang.Exception", "java.lang.RuntimeException", "java.lang.IllegalArgumentException",
        "java.lang.IllegalStateException", "java.lang.UnsupportedOperationException", "java.lang.NullPointerException",
        "java.lang.IndexOutOfBoundsException", "java.lang.InterruptedException", "java.lang.ArithmeticException",
        "java.lang.Comparable", "java.lang.Iterable", "java.lang.Enum", "java.lang.Record", "java.lang.CharSequence",
        "java.lang.AutoCloseable", "java.lang.Cloneable", "java.lang.Throwable", "java.lang.Error", "java.lang.Class",
        "java.lang.ThreadLocal", "java.lang.Runtime",
        "java.util.Collection", "java.util.List", "java.util.ArrayList", "java.util.LinkedList", "java.util.Map",
        "java.util.HashMap", "java.util.LinkedHashMap", "java.util.TreeMap", "java.util.SortedMap", "java.util.NavigableMap",
        "java.util.Map$Entry", "java.util.Set", "java.util.HashSet", "java.util.LinkedHashSet", "java.util.TreeSet",
        "java.util.SortedSet", "java.util.NavigableSet", "java.util.Queue", "java.util.Deque", "java.util.ArrayDeque",
        "java.util.PriorityQueue", "java.util.Stack", "java.util.Vector", "java.util.Collections", "java.util.Arrays",
        "java.util.Optional", "java.util.OptionalInt", "java.util.Objects", "java.util.UUID", "java.util.Random",
        "java.util.Scanner", "java.util.Iterator", "java.util.ListIterator", "java.util.Comparator", "java.util.EnumMap",
        "java.util.EnumSet", "java.util.StringJoiner", "java.util.BitSet", "java.util.Date", "java.util.Timer",
        "java.util.TimerTask", "java.util.Locale", "java.util.Properties", "java.util.WeakHashMap", "java.util.IdentityHashMap",
        "java.util.NoSuchElementException", "java.util.ConcurrentModificationException",
        "java.util.concurrent.ConcurrentHashMap", "java.util.concurrent.ConcurrentMap", "java.util.concurrent.ConcurrentLinkedQueue",
        "java.util.concurrent.ConcurrentLinkedDeque", "java.util.concurrent.ConcurrentSkipListMap",
        "java.util.concurrent.ConcurrentSkipListSet", "java.util.concurrent.CopyOnWriteArrayList",
        "java.util.concurrent.CopyOnWriteArraySet", "java.util.concurrent.BlockingQueue", "java.util.concurrent.BlockingDeque",
        "java.util.concurrent.LinkedBlockingQueue", "java.util.concurrent.LinkedBlockingDeque",
        "java.util.concurrent.ArrayBlockingQueue", "java.util.concurrent.PriorityBlockingQueue", "java.util.concurrent.DelayQueue",
        "java.util.concurrent.Delayed", "java.util.concurrent.SynchronousQueue", "java.util.concurrent.Executor",
        "java.util.concurrent.ExecutorService", "java.util.concurrent.ScheduledExecutorService", "java.util.concurrent.Executors",
        "java.util.concurrent.ThreadPoolExecutor", "java.util.concurrent.ScheduledThreadPoolExecutor",
        "java.util.concurrent.ForkJoinPool", "java.util.concurrent.Future", "java.util.concurrent.ScheduledFuture",
        "java.util.concurrent.CompletableFuture", "java.util.concurrent.Callable", "java.util.concurrent.TimeUnit",
        "java.util.concurrent.CountDownLatch", "java.util.concurrent.CyclicBarrier", "java.util.concurrent.Semaphore",
        "java.util.concurrent.Phaser", "java.util.concurrent.Exchanger", "java.util.concurrent.ThreadLocalRandom",
        "java.util.concurrent.ThreadFactory", "java.util.concurrent.ExecutionException", "java.util.concurrent.TimeoutException",
        "java.util.concurrent.atomic.AtomicInteger", "java.util.concurrent.atomic.AtomicLong",
        "java.util.concurrent.atomic.AtomicBoolean", "java.util.concurrent.atomic.AtomicReference",
        "java.util.concurrent.atomic.LongAdder", "java.util.concurrent.locks.Lock", "java.util.concurrent.locks.ReentrantLock",
        "java.util.concurrent.locks.ReadWriteLock", "java.util.concurrent.locks.ReentrantReadWriteLock",
        "java.util.concurrent.locks.Condition", "java.util.concurrent.locks.StampedLock",
        "java.util.function.Function", "java.util.function.BiFunction", "java.util.function.Supplier",
        "java.util.function.Consumer", "java.util.function.BiConsumer", "java.util.function.Predicate",
        "java.util.function.BiPredicate", "java.util.function.UnaryOperator", "java.util.function.BinaryOperator",
        "java.util.function.IntFunction", "java.util.function.ToIntFunction", "java.util.function.IntPredicate",
        "java.util.stream.Stream", "java.util.stream.Collectors", "java.util.stream.IntStream", "java.util.stream.LongStream",
        "java.util.stream.DoubleStream", "java.util.stream.Collector",
        "java.time.LocalDate", "java.time.LocalDateTime", "java.time.LocalTime", "java.time.Instant", "java.time.Duration",
        "java.time.Period", "java.time.ZonedDateTime", "java.time.ZoneId", "java.time.Clock", "java.time.DayOfWeek",
        "java.time.temporal.ChronoUnit", "java.time.format.DateTimeFormatter",
        "java.math.BigDecimal", "java.math.BigInteger", "java.math.RoundingMode",
        "java.io.BufferedReader", "java.io.InputStreamReader", "java.io.PrintStream", "java.io.IOException",
        "java.io.File", "java.io.FileWriter", "java.io.FileReader", "java.io.BufferedWriter", "java.io.Serializable",
        "java.io.UncheckedIOException", "java.nio.file.Files", "java.nio.file.Path", "java.nio.file.Paths",
        "java.text.SimpleDateFormat", "java.text.DecimalFormat",
    };

    public static void main(String[] args) {
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (String name : CLASSES) {
            Class<?> c;
            try {
                c = Class.forName(name);
            } catch (Throwable t) {
                continue;
            }
            if (!first) sb.append(',');
            first = false;
            writeClass(sb, c);
        }
        sb.append(']');
        System.out.print(sb);
    }

    static void writeClass(StringBuilder sb, Class<?> c) {
        String kind = c.isInterface() ? "interface" : c.isEnum() ? "enum" : c.isRecord() ? "record" : "class";
        sb.append("{\"name\":").append(q(simpleName(c)))
          .append(",\"fqn\":").append(q(c.getName().replace('$', '.')))
          .append(",\"pkg\":").append(q(c.getPackageName()))
          .append(",\"kind\":").append(q(kind))
          .append(",\"typeParams\":").append(q(typeParams(c.getTypeParameters())));
        if (c.getGenericSuperclass() != null) sb.append(",\"superclass\":").append(q(simplify(c.getGenericSuperclass().getTypeName())));
        sb.append(",\"constructors\":[");
        boolean first = true;
        if (!Modifier.isAbstract(c.getModifiers()) && !c.isInterface()) {
            for (Constructor<?> k : c.getConstructors()) {
                if (k.isAnnotationPresent(Deprecated.class)) continue;
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"params\":").append(params(k.getGenericParameterTypes(), k.isVarArgs())).append('}');
            }
        }
        sb.append("],\"methods\":[");
        first = true;
        Method[] methods = c.getMethods();
        Arrays.sort(methods, Comparator.comparing(Method::getName));
        Set<String> seen = new HashSet<>();
        for (Method m : methods) {
            if (m.isSynthetic() || m.isBridge() || m.isAnnotationPresent(Deprecated.class)) continue;
            String sig = m.getName() + Arrays.toString(m.getGenericParameterTypes());
            if (!seen.add(sig)) continue;
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"name\":").append(q(m.getName()))
              .append(",\"params\":").append(params(m.getGenericParameterTypes(), m.isVarArgs()))
              .append(",\"returns\":").append(q(simplify(m.getGenericReturnType().getTypeName())))
              .append(",\"typeParams\":").append(q(typeParams(m.getTypeParameters())))
              .append(",\"static\":").append(Modifier.isStatic(m.getModifiers()))
              .append(",\"declaringClass\":").append(q(simpleName(m.getDeclaringClass())))
              .append('}');
        }
        sb.append("],\"fields\":[");
        first = true;
        for (Field f : c.getFields()) {
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"name\":").append(q(f.getName()))
              .append(",\"type\":").append(q(simplify(f.getGenericType().getTypeName())))
              .append(",\"static\":").append(Modifier.isStatic(f.getModifiers()))
              .append('}');
        }
        sb.append("]}");
    }

    static String simpleName(Class<?> c) {
        return c.getName().substring(c.getName().lastIndexOf('.') + 1).replace('$', '.');
    }

    static String typeParams(TypeVariable<?>[] tps) {
        if (tps.length == 0) return "";
        StringJoiner j = new StringJoiner(", ", "<", ">");
        for (TypeVariable<?> tp : tps) j.add(tp.getName());
        return j.toString();
    }

    static String params(Type[] types, boolean varArgs) {
        StringJoiner j = new StringJoiner(",", "[", "]");
        for (int i = 0; i < types.length; i++) {
            String t = simplify(types[i].getTypeName());
            if (varArgs && i == types.length - 1 && t.endsWith("[]")) t = t.substring(0, t.length() - 2) + "...";
            j.add(q(t));
        }
        return j.toString();
    }

    /** java.util.Map<K, V> -> Map<K, V>, java.util.Map$Entry -> Map.Entry */
    static String simplify(String typeName) {
        return typeName.replaceAll("\\b(?:[a-z_][\\w]*\\.)+([A-Z][\\w$]*)", "$1").replace('$', '.');
    }

    static String q(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }
}
